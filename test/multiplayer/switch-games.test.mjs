// Game switching and the room-level win tally.
//
// Wins are counted by the ROOM from state.winner, not by each game: Snake keeps
// its own tally, Double It Duel keeps none, and Codenames is co-op. Going back to
// the lobby discards the game state, so a per-game tally cannot survive a switch —
// which is exactly what this checks.
//
// Start a server yourself first (see README):
//   SESSION_SECRET=localtestsecret NODE_ENV=production PORT=3102 node server.js

import path from "node:path";
import crypto from "node:crypto";

const REPO = "/Users/edeclan/TestProjects/Minigames";
const { io } = await import(path.join(REPO, "node_modules/socket.io-client/build/esm/index.js"));
const URL = process.env.BASE || `http://localhost:${process.env.PORT || "3100"}`;
const SECRET = "localtestsecret";

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ck(u) {
  const m = crypto.createHmac("sha256", SECRET).update(u).digest("hex").slice(0, 32);
  return `minigames_id=${encodeURIComponent(u + "." + m)}`;
}
function client(u) {
  const s = io(URL, { transports: ["websocket"], extraHeaders: { Cookie: ck(u) } });
  const c = { s, uid: u, states: [], errors: [], joined: null };
  s.on("room_state", (st) => c.states.push(st));
  s.on("room_error", (e) => c.errors.push(e));
  s.on("joined", (j) => { c.joined = j; });
  c.last = () => c.states[c.states.length - 1];
  c.game = () => c.last()?.gameState;
  Object.defineProperty(c, "id", { get: () => c.joined?.userId ?? c.uid });
  return c;
}

const H = crypto.randomUUID(), G = crypto.randomUUID();
const a = client(H), b = client(G);
await wait(800);
a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(600);
const code = a.joined.roomCode;
b.s.emit("join_room", { roomCode: code, name: "Ben" });
await wait(600);
t("two players in the room", a.last()?.players?.length === 2);
t("room starts with no wins", JSON.stringify(a.last()?.roomWins ?? {}) === "{}",
  JSON.stringify(a.last()?.roomWins));

// ---------- play a Double It Duel to a real win ----------
a.s.emit("select_game", { game: "double-it-duel" });
await wait(500);
t("duel selected", a.last()?.game === "double-it-duel");
a.s.emit("game_event", { event: "settings", data: { startSeconds: 10, abyssSeconds: 5 } });
await wait(400);
a.s.emit("game_event", { event: "start" });
await wait(600);
// Nobody answers; the tick eliminates them until one is left.
for (let i = 0; i < 40 && a.game()?.phase !== "over"; i++) await wait(1000);
t("the duel produced a winner", a.game()?.phase === "over" && !!a.game()?.winner,
  `${a.game()?.phase}/${a.game()?.winner?.slice(0, 8)}`);
const winner = a.game()?.winner;
t("room tally recorded the win", (a.last()?.roomWins?.[winner] ?? 0) === 1,
  JSON.stringify(a.last()?.roomWins));

// ---------- go BACK TO LOBBY without leaving ----------
b.errors.length = 0;
b.s.emit("back_to_lobby");
await wait(500);
t("a non-host cannot go back", a.last()?.game === "double-it-duel", String(a.last()?.game));
t("non-host is told why", b.errors.some((e) => /only the host/i.test(e.message ?? "")),
  JSON.stringify(b.errors));

a.s.emit("back_to_lobby");
await wait(700);
t("host returned to the picker", a.last()?.game === null, String(a.last()?.game));
t("game state cleared", a.last()?.gameState == null, JSON.stringify(a.last()?.gameState));
t("NOBODY left the room", a.last()?.players?.length === 2,
  JSON.stringify(a.last()?.players?.map((p) => p.name)));
t("host seat kept", a.joined?.isHost === true);
t("both still connected", a.last()?.players?.every((p) => p.connected),
  JSON.stringify(a.last()?.players?.map((p) => p.connected)));
t("the guest sees the lobby too", b.last()?.game === null, String(b.last()?.game));
t("WINS SURVIVED going back", (a.last()?.roomWins?.[winner] ?? 0) === 1,
  JSON.stringify(a.last()?.roomWins));

// ---------- switch to a DIFFERENT game ----------
a.s.emit("select_game", { game: "codenames" });
await wait(600);
t("switched to a different game", a.last()?.game === "codenames", String(a.last()?.game));
t("wins survived the switch", (a.last()?.roomWins?.[winner] ?? 0) === 1,
  JSON.stringify(a.last()?.roomWins));
t("the new game has its own fresh state", a.game()?.phase === "lobby",
  String(a.game()?.phase));

// ---------- and back again, to the ORIGINAL game ----------
a.s.emit("select_game", { game: "double-it-duel" });
await wait(600);
t("switched back", a.last()?.game === "double-it-duel");
t("wins still intact after two switches", (a.last()?.roomWins?.[winner] ?? 0) === 1,
  JSON.stringify(a.last()?.roomWins));
t("the returning game is fresh, not resumed", a.game()?.phase === "lobby",
  String(a.game()?.phase));

// ---------- a second win ACCUMULATES rather than replacing ----------
a.s.emit("game_event", { event: "settings", data: { startSeconds: 10, abyssSeconds: 5 } });
await wait(400);
a.s.emit("game_event", { event: "start" });
await wait(600);
for (let i = 0; i < 40 && a.game()?.phase !== "over"; i++) await wait(1000);
const totals = a.last()?.roomWins ?? {};
const sum = Object.values(totals).reduce((n, v) => n + v, 0);
t("a second win was added", sum === 2, JSON.stringify(totals));

a.s.disconnect(); b.s.disconnect();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
