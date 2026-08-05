/**
 * End-to-end verification of room persistence across a real server restart.
 *
 * Self-contained: this script starts and stops the server itself, so it can't be
 * derailed by an inherited cwd or a missing `timeout` binary — both of which
 * broke earlier attempts and made product bugs and harness bugs hard to tell
 * apart.
 *
 * The restart is a genuine SIGINT (what `pm2 restart` sends) delivered while
 * clients stay connected, because that is the real deploy scenario.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve the repo from this file, so the suite runs from any checkout.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO_ROOT, "node_modules/socket.io-client/build/esm/index.js")
);
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";

const REPO = REPO_ROOT;
const PORT = process.env.PORT || "3080";
const URL = `http://localhost:${PORT}`;
const SECRET = "localtestsecret";

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;

async function startServer(tag) {
  const log = fs.openSync(`/tmp/persist-${tag}.log`, "w");
  child = spawn("node", ["server.js"], {
    cwd: REPO, // explicit: the earlier failures were all inherited-cwd bugs
    env: { ...process.env, SESSION_SECRET: SECRET, NODE_ENV: "production", PORT },
    stdio: ["ignore", log, log],
    detached: false,
  });
  // Poll the port rather than sleeping a fixed amount.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${URL}/multiplayer`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  return false;
}

/** SIGINT and wait for the process to actually exit. */
async function stopServer() {
  if (!child) return;
  const dead = new Promise((r) => child.once("exit", r));
  child.kill("SIGINT");
  await Promise.race([dead, wait(8000)]);
  child = null;
}

function ck(u) {
  const m = crypto.createHmac("sha256", SECRET).update(u).digest("hex").slice(0, 32);
  return `minigames_id=${encodeURIComponent(u + "." + m)}`;
}
function client(u, name) {
  const s = io(URL, {
    transports: ["websocket"],
    extraHeaders: { Cookie: ck(u) },
    reconnection: true,
    reconnectionDelay: 300,
    reconnectionAttempts: 50,
  });
  const c = { s, uid: u, name, states: [], errors: [], joined: null };
  s.on("room_state", (st) => c.states.push(st));
  s.on("room_error", (e) => c.errors.push(e));
  s.on("joined", (j) => { c.joined = j; });
  c.last = () => c.states[c.states.length - 1];
  c.game = () => c.last()?.gameState;
  c.paused = () => c.last()?.paused;
  return c;
}
const clockOf = (g, id) => g?.players?.find((p) => p.userId === id)?.ms;

console.log("=== phase 1: start a game ===");
if (!(await startServer("boot"))) {
  console.log("FAIL: server never came up");
  process.exit(1);
}

const H = crypto.randomUUID(), G = crypto.randomUUID(), C = crypto.randomUUID();
const host = client(H, "Ana");
const guest = client(G, "Ben");
const third = client(C, "Cam");
await wait(900);

host.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(600);
const code = host.joined?.roomCode;
t("room created", !!code, String(code));
guest.s.emit("join_room", { roomCode: code, name: "Ben" });
third.s.emit("join_room", { roomCode: code, name: "Cam" });
await wait(800);
t("three players joined", host.last()?.players?.length === 3,
  JSON.stringify(host.last()?.players?.map((p) => p.name)));

host.s.emit("select_game", { game: "double-it-duel" });
await wait(500);
host.s.emit("game_event", { event: "settings", data: { startSeconds: 60, abyssSeconds: 1 } });
await wait(400);
host.s.emit("game_event", { event: "start" });
await wait(700);

// Play a couple of real turns so there is progress worth preserving.
for (let i = 0; i < 2; i++) {
  const g = host.game();
  if (g?.phase !== "playing") break;
  const who = [host, guest, third].find((c) => c.uid === g.turnUserId);
  if (!who) break;
  await wait(1200);
  who.s.emit("game_event", { event: "answer", data: { value: g.prompt * g.settings.multiplier } });
  await wait(600);
}

const pre = host.game();
t("game is running", pre?.phase === "playing", String(pre?.phase));
t("progress was made", pre?.players?.some((p) => p.solved > 0),
  JSON.stringify(pre?.players?.map((p) => p.solved)));
t("nobody eliminated yet", pre?.players?.every((p) => p.alive));
const preSnapshot = {
  hostId: host.last().hostId,
  turnUserId: pre.turnUserId,
  prompt: pre.prompt,
  settings: pre.settings,
  turnsTaken: pre.turnsTaken,
  players: pre.players.map((p) => ({ u: p.userId, ms: Math.round(p.ms), solved: p.solved })),
};

console.log("=== phase 2: SIGINT, exactly what pm2 restart sends ===");
await stopServer();
await wait(500);

// The snapshot must be on disk before anything else is checked.
const dbFile = `${REPO}/data/minigames.db`;
t("database exists after the drain", fs.existsSync(dbFile));
const drainLog = fs.readFileSync("/tmp/persist-boot.log", "utf8");
t("drain reported saving a room", /paused and saved \d+ room/.test(drainLog),
  drainLog.split("\n").filter((l) => l.includes("saved")).join(" | "));

console.log("=== phase 3: restart and reconnect ===");
if (!(await startServer("restart"))) {
  console.log("FAIL: server never came back up");
  process.exit(1);
}
const bootLog = fs.readFileSync("/tmp/persist-restart.log", "utf8");
t("boot reported restoring a room", /Restored \d+ paused room/.test(bootLog),
  bootLog.split("\n").filter((l) => l.includes("Restor")).join(" | "));

// socket.io reconnects on its own; useRoom re-emits join_room on reconnect.
await wait(3000);
[host, guest, third].forEach((c) => {
  if (!c.s.connected) c.s.connect();
});
await wait(1500);
host.s.emit("join_room", { roomCode: code, name: "Ana" });
guest.s.emit("join_room", { roomCode: code, name: "Ben" });
third.s.emit("join_room", { roomCode: code, name: "Cam" });
await wait(2000);

t("no NOT_FOUND — the room still exists",
  !host.errors.some((e) => e.code === "NOT_FOUND"), JSON.stringify(host.errors));
const st = host.last();
t("rejoined the same code", st?.roomCode === code, `${st?.roomCode} vs ${code}`);
t("host seat preserved", st?.hostId === preSnapshot.hostId,
  `${preSnapshot.hostId?.slice(0, 8)} -> ${st?.hostId?.slice(0, 8)}`);
t("Ana is still flagged host", host.joined?.isHost === true, JSON.stringify(host.joined));
t("room came back PAUSED", st?.paused != null, JSON.stringify(st?.paused));
t("pause reason is restart", st?.paused?.reason === "restart", JSON.stringify(st?.paused));
t("no duplicate players", st?.players?.length === 3,
  JSON.stringify(st?.players?.map((p) => p.name)));

const post = host.game();
t("game still selected", st?.game === "double-it-duel", String(st?.game));
t("phase preserved, NOT ended", post?.phase === "playing", String(post?.phase));
t("nobody was eliminated by the restart", post?.players?.every((p) => p.alive),
  JSON.stringify(post?.players?.map((p) => [Math.round(p.ms), p.alive])));
t("settings survived",
  post?.settings?.startSeconds === preSnapshot.settings.startSeconds &&
    post?.settings?.multiplier === preSnapshot.settings.multiplier,
  JSON.stringify(post?.settings));
t("solved counts survived",
  JSON.stringify(post?.players?.map((p) => p.solved)) ===
    JSON.stringify(preSnapshot.players.map((p) => p.solved)),
  JSON.stringify(post?.players?.map((p) => p.solved)));
t("turn holder preserved", post?.turnUserId === preSnapshot.turnUserId,
  `${preSnapshot.turnUserId?.slice(0, 8)} -> ${post?.turnUserId?.slice(0, 8)}`);
t("rotation progress survived", post?.turnsTaken === preSnapshot.turnsTaken,
  `${preSnapshot.turnsTaken} -> ${post?.turnsTaken}`);

const before = new Map(preSnapshot.players.map((p) => [p.u, p.ms]));
const drift = (post?.players ?? []).map((p) => Math.abs(p.ms - (before.get(p.userId) ?? 0)));
t("clocks preserved across the restart", drift.every((d) => d < 2000),
  JSON.stringify(drift));

// A paused room must not tick.
const m1 = post.players.map((p) => Math.round(p.ms));
await wait(2500);
const m2 = host.game().players.map((p) => Math.round(p.ms));
t("clocks stay frozen while paused", JSON.stringify(m1) === JSON.stringify(m2),
  `${JSON.stringify(m1)} -> ${JSON.stringify(m2)}`);

// Game events must be refused until the host resumes.
const turnHolder = [host, guest, third].find((c) => c.uid === host.game().turnUserId);
if (turnHolder) {
  turnHolder.errors.length = 0;
  turnHolder.s.emit("game_event", { event: "answer", data: { value: 1 } });
  await wait(500);
  t("answers refused while paused",
    turnHolder.errors.some((e) => /paused/i.test(e.message ?? "")),
    JSON.stringify(turnHolder.errors));
}

console.log("=== phase 4: resume and keep playing ===");
guest.errors.length = 0;
guest.s.emit("resume_game");
await wait(500);
t("a non-host cannot resume", host.game() && host.last().paused != null);

host.s.emit("resume_game");
await wait(700);
t("host resumed the restored game", host.last()?.paused == null,
  JSON.stringify(host.last()?.paused));

await wait(1300);
const running = host.game();
const active = running.players.find((p) => p.userId === running.turnUserId);
t("the clock runs again", active.ms < 60_000, String(Math.round(active.ms)));

const g2 = host.game();
const nowActor = [host, guest, third].find((c) => c.uid === g2.turnUserId);
nowActor.s.emit("game_event", { event: "answer", data: { value: g2.prompt * g2.settings.multiplier } });
await wait(800);
t("play continues after the restart", host.game()?.lastEvent?.kind === "correct",
  JSON.stringify(host.game()?.lastEvent));

// The snapshot must be consumed, or the same rooms come back next restart too.
const dbCheck = spawn("node", ["-e",
  "const D=require('better-sqlite3');const db=new D('data/minigames.db');" +
  "console.log(db.prepare('SELECT COUNT(*) n FROM room_snapshots').get().n)"],
  { cwd: REPO });
let dbOut = "";
dbCheck.stdout.on("data", (d) => { dbOut += d; });
await new Promise((r) => dbCheck.once("exit", r));
t("snapshots are single-use (table empty)", dbOut.trim() === "0", dbOut.trim());

[host, guest, third].forEach((c) => c.s.disconnect());
await stopServer();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
