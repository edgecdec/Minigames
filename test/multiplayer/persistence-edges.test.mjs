/**
 * Edge cases around room persistence that the happy path doesn't reach.
 *
 * Each case starts from a clean database so results can't leak between them.
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
const PORT = process.env.PORT || "3081";
const URL = `http://localhost:${PORT}`;
const SECRET = "localtestsecret";

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let child = null;

async function start(tag) {
  // Refuse to start on an occupied port: adopting whatever is already there was
  // the root cause of the misleading failures.
  try {
    await fetch(`${URL}/multiplayer`);
    throw new Error(`port ${PORT} is already serving before start(${tag})`);
  } catch (err) {
    if (String(err.message).includes("already serving")) throw err;
  }
  const log = fs.openSync(`/tmp/edge-${tag}.log`, "w");
  child = spawn("node", ["server.js"], {
    cwd: REPO,
    env: { ...process.env, SESSION_SECRET: SECRET, NODE_ENV: "production", PORT },
    stdio: ["ignore", log, log],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${URL}/multiplayer`)).ok) return true;
    } catch { /* not up */ }
    await wait(500);
  }
  return false;
}
async function stop() {
  if (!child) return;
  const dead = new Promise((r) => child.once("exit", r));
  child.kill("SIGINT");
  await Promise.race([dead, wait(8000)]);
  child = null;
  // Wait for the PORT to actually free up, not just for the exit event.
  // Without this the next start() hits EADDRINUSE and the suite quietly keeps
  // talking to the old process — every "failure" after that is a lie.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${URL}/multiplayer`);
      await wait(250);   // still answering: not free yet
    } catch {
      return;            // connection refused == port released
    }
  }
  throw new Error("port never freed after SIGINT");
}
function wipeDb() {
  for (const f of ["minigames.db", "minigames.db-shm", "minigames.db-wal"]) {
    try { fs.unlinkSync(`${REPO}/data/${f}`); } catch { /* absent */ }
  }
}
function ck(u) {
  const m = crypto.createHmac("sha256", SECRET).update(u).digest("hex").slice(0, 32);
  return `minigames_id=${encodeURIComponent(u + "." + m)}`;
}
function client(u) {
  const s = io(URL, {
    transports: ["websocket"],
    extraHeaders: { Cookie: ck(u) },
    reconnection: true, reconnectionDelay: 300, reconnectionAttempts: 50,
  });
  const c = { s, uid: u, states: [], errors: [], joined: null };
  s.on("room_state", (st) => c.states.push(st));
  s.on("room_error", (e) => c.errors.push(e));
  s.on("joined", (j) => { c.joined = j; });
  c.last = () => c.states[c.states.length - 1];
  c.game = () => c.last()?.gameState;
  return c;
}
function readDb(sql) {
  const r = spawn("node", ["-e",
    `const D=require('better-sqlite3');const db=new D('data/minigames.db');console.log(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()))`],
    { cwd: REPO });
  let out = "";
  r.stdout.on("data", (d) => { out += d; });
  return new Promise((res) => r.once("exit", () => res(out.trim())));
}

// ---------- 1. A lobby-only room is NOT snapshotted ----------
console.log("=== 1. lobby-only room ===");
wipeDb();
await start("lobby");
{
  const a = client(crypto.randomUUID());
  await wait(800);
  a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
  await wait(600);
  t("lobby room created", !!a.joined?.roomCode);
  // No game selected at all.
  await stop();
  const rows = await readDb("SELECT code FROM room_snapshots");
  t("a room with no game is not saved", rows === "[]", rows);
  a.s.disconnect();
}

// ---------- 2. A FINISHED game is restored, but as finished ----------
console.log("=== 2. finished game ===");
wipeDb();
await start("finished");
{
  const H = crypto.randomUUID(), G = crypto.randomUUID();
  const a = client(H), b = client(G);
  await wait(800);
  a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
  await wait(500);
  const code = a.joined.roomCode;
  b.s.emit("join_room", { roomCode: code, name: "Ben" });
  await wait(500);
  a.s.emit("select_game", { game: "double-it-duel" });
  await wait(400);
  // 10s clocks so it ends quickly.
  a.s.emit("game_event", { event: "settings", data: { startSeconds: 10, abyssSeconds: 5 } });
  await wait(300);
  a.s.emit("game_event", { event: "start" });
  await wait(600);
  // Nobody answers: the tick eliminates them one at a time.
  for (let i = 0; i < 30 && a.game()?.phase === "playing"; i++) await wait(1000);
  t("game reached a result", a.game()?.phase === "over", String(a.game()?.phase));
  const winner = a.game()?.winner;

  await stop();
  await start("finished2");
  await wait(2500);
  [a, b].forEach((c) => { if (!c.s.connected) c.s.connect(); });
  await wait(1200);
  a.s.emit("join_room", { roomCode: code, name: "Ana" });
  await wait(1500);
  t("a finished game is still restorable", !a.errors.some((e) => e.code === "NOT_FOUND"),
    JSON.stringify(a.errors));
  t("it comes back still finished", a.game()?.phase === "over", String(a.game()?.phase));
  t("the winner is preserved", a.game()?.winner === winner,
    `${winner?.slice(0, 8)} -> ${a.game()?.winner?.slice(0, 8)}`);
  a.s.disconnect(); b.s.disconnect();
  await stop();
}

// ---------- 3. A stale snapshot is dropped, not restored ----------
console.log("=== 3. stale snapshot ===");
wipeDb();
await start("stale");
{
  const H = crypto.randomUUID(), G = crypto.randomUUID();
  const a = client(H), b = client(G);
  await wait(800);
  a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
  await wait(500);
  const code = a.joined.roomCode;
  b.s.emit("join_room", { roomCode: code, name: "Ben" });
  await wait(500);
  a.s.emit("select_game", { game: "codenames" });
  await wait(400);
  a.s.emit("game_event", { event: "start" });
  await wait(500);
  // Deliberately stay connected: disconnecting first can let the sweeper reap
  // the room as empty before the drain ever sees it.
  await stop();

  const rows = await readDb("SELECT code FROM room_snapshots");
  t("snapshot written before ageing it", rows !== "[]", rows);

  // Back-date it two hours; the loader's cutoff is one.
  const age = spawn("node", ["-e",
    "const D=require('better-sqlite3');const db=new D('data/minigames.db');" +
    "db.prepare('UPDATE room_snapshots SET saved_at = ?').run(Date.now() - 2*60*60*1000);" +
    "console.log('aged')"], { cwd: REPO });
  await new Promise((r) => age.once("exit", r));

  await start("stale2");
  const log = fs.readFileSync("/tmp/edge-stale2.log", "utf8");
  t("a stale snapshot is dropped", /Dropped \d+ stale room snapshot/.test(log),
    log.split("\n").filter((l) => l.includes("Drop") || l.includes("Restor")).join(" | "));
  t("and NOT restored", !/Restored \d+ paused room/.test(log),
    log.split("\n").filter((l) => l.includes("Restor")).join(" | "));

  const c = client(crypto.randomUUID());
  await wait(800);
  c.s.emit("join_room", { roomCode: code, name: "Zed" });
  await wait(1000);
  t("the stale room is genuinely gone", c.errors.some((e) => e.code === "NOT_FOUND"),
    JSON.stringify(c.errors));
  c.s.disconnect();
  a.s.disconnect(); b.s.disconnect();
  await stop();
}

// ---------- 4. Snake, which has a tick rather than a clock ----------
console.log("=== 4. snake tick ===");
wipeDb();
await start("snake");
{
  const H = crypto.randomUUID(), G = crypto.randomUUID();
  const a = client(H), b = client(G);
  await wait(800);
  a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
  await wait(500);
  const code = a.joined.roomCode;
  b.s.emit("join_room", { roomCode: code, name: "Ben" });
  await wait(500);
  a.s.emit("select_game", { game: "snake-duel" });
  await wait(400);
  a.s.emit("game_event", { event: "start" });
  // Must clear the full 3-2-1 countdown, which runs on real seconds now. 2500ms
  // landed inside it, where tick is legitimately still 0.
  await wait(4200);
  const preTick = a.game()?.tick;
  t("snake was ticking", preTick > 0, String(preTick));

  await stop();
  await start("snake2");
  await wait(2500);
  [a, b].forEach((c) => { if (!c.s.connected) c.s.connect(); });
  await wait(1200);
  a.s.emit("join_room", { roomCode: code, name: "Ana" });
  b.s.emit("join_room", { roomCode: code, name: "Ben" });
  await wait(1500);

  t("snake room restored", !a.errors.some((e) => e.code === "NOT_FOUND"), JSON.stringify(a.errors));
  t("snake came back paused", a.last()?.paused != null, JSON.stringify(a.last()?.paused));
  const restoredTick = a.game()?.tick;
  t("the board survived", restoredTick >= preTick - 2,
    `${preTick} -> ${restoredTick}`);
  const hold = a.game()?.tick;
  await wait(2000);
  t("the tick is frozen while paused", a.game()?.tick === hold,
    `${hold} -> ${a.game()?.tick}`);
  a.s.emit("resume_game");
  await wait(1500);
  t("the tick resumes", a.game()?.tick > hold, `${hold} -> ${a.game()?.tick}`);
  a.s.disconnect(); b.s.disconnect();
  await stop();
}

await stop();
wipeDb();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
