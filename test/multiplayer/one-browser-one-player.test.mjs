/**
 * One browser is one player, and the session scoreboard survives a restart.
 *
 * The bug: opening an invite link twice in the same browser joined twice. A
 * visitor who had never submitted a score had no identity cookie, so the room
 * layer minted a throwaway anon id — correctly once per SOCKET — and a second tab
 * meant a second socket, hence a second player the room then waited on forever.
 *
 * The fix has two halves and this checks both:
 *   1. the client mints a durable cookie over HTTP before connecting, so both
 *      tabs present the same signed id
 *   2. the room counts SOCKETS per seat, so closing one tab doesn't mark a player
 *      away (or forfeit their game) while another tab is still playing
 *
 * Starts and stops its own server — do NOT have one running on PORT.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO, "node_modules/socket.io-client/build/esm/index.js")
);

const PORT = process.env.PORT || "3084";
const URL = `http://localhost:${PORT}`;
const SECRET = "localtestsecret";

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let child = null;

async function start(tag) {
  // Refuse to adopt a server we didn't start: doing so is the most misleading
  // thing a suite can do.
  try {
    await fetch(`${URL}/multiplayer`);
    throw new Error(`port ${PORT} is already serving before start(${tag})`);
  } catch (err) {
    if (String(err.message).includes("already serving")) throw err;
  }
  const log = fs.openSync(`/tmp/obop-${tag}.log`, "w");
  child = spawn("node", ["server.js"], {
    cwd: REPO,
    env: { ...process.env, SESSION_SECRET: SECRET, NODE_ENV: "production", PORT },
    stdio: ["ignore", log, log],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${URL}/multiplayer`)).ok) return true; } catch { /* not up */ }
    await wait(500);
  }
  throw new Error("server never came up");
}

async function stop() {
  if (!child) return;
  const dead = new Promise((r) => child.once("exit", r));
  child.kill("SIGINT");
  await Promise.race([dead, wait(8000)]);
  child = null;
  // Wait for the port to be RELEASED, not just for the exit event, or the next
  // start() hits EADDRINUSE and every later assertion is a lie.
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${URL}/multiplayer`); await wait(250); } catch { return; }
  }
  throw new Error("port never freed");
}

function wipeDb() {
  for (const f of ["minigames.db", "minigames.db-shm", "minigames.db-wal"]) {
    try { fs.unlinkSync(`${REPO}/data/${f}`); } catch { /* absent */ }
  }
}

/**
 * A browser: a cookie jar shared by every "tab" it opens.
 *
 * `POST /api/identity` is what the real client calls before connecting, so this
 * exercises the actual mechanism rather than pre-baking a cookie.
 */
async function browser() {
  const res = await fetch(`${URL}/api/identity`, { method: "POST" });
  const setCookie = res.headers.get("set-cookie") || "";
  const jar = setCookie.split(";")[0];
  return {
    jar,
    tab() {
      const s = io(URL, { transports: ["websocket"], extraHeaders: { Cookie: jar } });
      const c = { s, states: [], errors: [], joined: null };
      s.on("room_state", (st) => c.states.push(st));
      s.on("room_error", (e) => c.errors.push(e));
      s.on("joined", (j) => { c.joined = j; });
      c.last = () => c.states[c.states.length - 1];
      c.game = () => c.last()?.gameState;
      return c;
    },
  };
}

wipeDb();
await start("main");

// ---------- 1. the identity endpoint issues a durable signed cookie ----------
console.log("=== 1. identity cookie ===");
const alice = await browser();
t("a cookie is issued", /minigames_id=/.test(alice.jar), alice.jar.slice(0, 24));
t("it is signed, not a bare id", /%2E|\./.test(decodeURIComponent(alice.jar)));
{
  // A second call with the cookie already held must NOT mint a new identity.
  const again = await fetch(`${URL}/api/identity`, {
    method: "POST",
    headers: { Cookie: alice.jar },
  });
  const re = again.headers.get("set-cookie");
  t("an existing id is left alone", !re, String(re).slice(0, 40));
}

// ---------- 2. two tabs of one browser are ONE player ----------
console.log("=== 2. two tabs, one seat ===");
const t1 = alice.tab();
await wait(700);
t1.s.emit("join_room", { roomCode: "NEW", name: "Alice" });
await wait(600);
const code = t1.joined.roomCode;
t("the first tab joined", !!code);

const t2 = alice.tab();          // same jar: the invite link, opened again
await wait(600);
t2.s.emit("join_room", { roomCode: code, name: "Alice" });
await wait(700);

t("still ONE player after a second tab", t1.last()?.players?.length === 1,
  JSON.stringify(t1.last()?.players?.map((p) => p.name)));
t("both tabs are the same userId", t1.joined.userId === t2.joined.userId,
  `${t1.joined.userId?.slice(0, 8)} vs ${t2.joined.userId?.slice(0, 8)}`);
t("the second tab sees the room", t2.last()?.roomCode === code);
t("no anon fallback was used", !t1.joined.userId.startsWith("anon-"),
  t1.joined.userId.slice(0, 10));

// A DIFFERENT browser is genuinely a different player.
const bob = await browser();
const b1 = bob.tab();
await wait(600);
b1.s.emit("join_room", { roomCode: code, name: "Bob" });
await wait(700);
t("a different browser IS a second player", t1.last()?.players?.length === 2,
  JSON.stringify(t1.last()?.players?.map((p) => p.name)));
t("and gets its own id", b1.joined.userId !== t1.joined.userId);

// ---------- 3. closing a duplicate tab must not remove the player ----------
console.log("=== 3. closing one tab ===");
t1.s.emit("select_game", { game: "double-it-duel" });
await wait(400);
t1.s.emit("game_event", { event: "settings", data: { startSeconds: 60, abyssSeconds: 5 } });
await wait(300);
t1.s.emit("game_event", { event: "start" });
await wait(700);
t("the duel is running", t1.game()?.phase === "playing", String(t1.game()?.phase));

t2.s.disconnect();               // close the duplicate tab only
await wait(900);
const alicePlayer = () => b1.last()?.players?.find((p) => p.id === t1.joined.userId);
t("Alice is still IN the room", !!alicePlayer(),
  JSON.stringify(b1.last()?.players?.map((p) => p.name)));
t("Alice is NOT marked away", alicePlayer()?.connected === true,
  String(alicePlayer()?.connected));
t("she still holds the host seat", b1.last()?.hostId === t1.joined.userId);
t("her duel seat was not forfeited",
  t1.game()?.players?.find((p) => p.userId === t1.joined.userId)?.alive === true);
t("the game is still playing", t1.game()?.phase === "playing", String(t1.game()?.phase));

// The LAST tab closing does mark her away.
t1.s.disconnect();
await wait(900);
t("closing the last tab DOES mark her away",
  b1.last()?.players?.find((p) => p.id === t2.joined.userId)?.connected === false,
  JSON.stringify(b1.last()?.players?.map((p) => [p.name, p.connected])));

// ---------- 4. the session scoreboard survives a restart ----------
console.log("=== 4. wins across a restart ===");
{
  const h = await browser(), g = await browser();
  const ha = h.tab(), gb = g.tab();
  await wait(700);
  ha.s.emit("join_room", { roomCode: "NEW", name: "Hosty" });
  await wait(600);
  const rc = ha.joined.roomCode;
  gb.s.emit("join_room", { roomCode: rc, name: "Guesty" });
  await wait(600);
  ha.s.emit("select_game", { game: "double-it-duel" });
  await wait(400);
  ha.s.emit("game_event", { event: "settings", data: { startSeconds: 10, abyssSeconds: 5 } });
  await wait(300);
  ha.s.emit("game_event", { event: "start" });
  await wait(600);
  // Nobody answers; the clock eliminates them until one is left.
  for (let i = 0; i < 40 && ha.game()?.phase !== "over"; i++) await wait(1000);
  const winner = ha.game()?.winner;
  t("a win was recorded before the restart", (ha.last()?.roomWins?.[winner] ?? 0) === 1,
    JSON.stringify(ha.last()?.roomWins));

  // Stay connected: a real deploy kills the SERVER while clients are attached.
  await stop();
  await start("restarted");
  await wait(2500);
  [ha, gb].forEach((c) => { if (!c.s.connected) c.s.connect(); });
  await wait(1200);
  ha.s.emit("join_room", { roomCode: rc, name: "Hosty" });
  await wait(1500);
  t("the room came back", ha.last()?.roomCode === rc, JSON.stringify(ha.errors));
  t("WINS SURVIVED the restart", (ha.last()?.roomWins?.[winner] ?? 0) === 1,
    JSON.stringify(ha.last()?.roomWins));

  // Going back to the lobby after a restart must not double-count the win that
  // was already banked before the snapshot.
  ha.s.emit("back_to_lobby");
  await wait(700);
  t("and are not double-counted", (ha.last()?.roomWins?.[winner] ?? 0) === 1,
    JSON.stringify(ha.last()?.roomWins));
  ha.s.disconnect(); gb.s.disconnect();
}

t1.s.disconnect(); t2.s.disconnect(); b1.s.disconnect();
await stop();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
