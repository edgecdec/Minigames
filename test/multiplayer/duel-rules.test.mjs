import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve the repo from this file, so the suite runs from any checkout.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO_ROOT, "node_modules/socket.io-client/build/esm/index.js")
);
import crypto from "node:crypto";

// BASE points the suite at a deployment; PORT is the local fallback.
const PORT = process.env.PORT || "3070";
const URL = process.env.BASE || `http://localhost:${PORT}`;
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
  // The id the SERVER assigned. Our signed cookie is only honoured when
  // SESSION_SECRET matches, so against a deployment `uid` is not what the room
  // knows us as — always compare against this.
  Object.defineProperty(c, "id", { get: () => c.joined?.userId ?? c.uid });
  return c;
}
const clockOf = (g, id) => g.players.find((p) => p.userId === id)?.ms;

const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const cs = ids.map(client);
await wait(800);
cs[0].s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(500);
const code = cs[0].joined.roomCode;
cs[1].s.emit("join_room", { roomCode: code, name: "Ben" });
cs[2].s.emit("join_room", { roomCode: code, name: "Cam" });
await wait(700);

cs[0].s.emit("select_game", { game: "double-it-duel" });
await wait(500);
let g = cs[0].game();
t("no penalty setting is exposed", g?.options?.wrongPenaltySeconds === undefined,
  JSON.stringify(Object.keys(g?.options ?? {})));
t("settings are just the three knobs", Object.keys(g?.settings ?? {}).length === 3,
  JSON.stringify(g?.settings));

cs[0].s.emit("game_event", { event: "settings", data: { startSeconds: 30, abyssSeconds: 1 } });
await wait(400);
t("host settings applied", cs[0].game().settings.startSeconds === 30);

cs[0].s.emit("game_event", { event: "start" });
await wait(600);
g = cs[0].game();
t("playing", g.phase === "playing", g.phase);
t("first rotation not yet done", g.firstRotationDone === false, String(g.firstRotationDone));

// ---------- a wrong answer keeps the turn and costs clock ----------
const holder = g.turnUserId;
const actor = cs.find((c) => c.id === holder);
const beforeMiss = clockOf(g, holder);
const oppBefore = g.players.filter((p) => p.userId !== holder).map((p) => ({ u: p.userId, ms: p.ms }));

actor.s.emit("game_event", { event: "answer", data: { value: -999 } });
await wait(600);
g = cs[0].game();
t("a wrong answer does NOT pass the turn", g.turnUserId === holder, String(g.turnUserId));
t("the miss is reported", g.lastEvent?.kind === "wrong", JSON.stringify(g.lastEvent));
// The clock is the only cost: a miss charges the wall time spent, no more.
t("the miss charged the elapsed time only", clockOf(g, holder) <= beforeMiss,
  `${Math.round(beforeMiss)} -> ${Math.round(clockOf(g, holder))}`);
t("a miss gives opponents nothing",
  oppBefore.every((o) => Math.abs(clockOf(g, o.u) - o.ms) < 60),
  JSON.stringify(oppBefore.map((o) => [Math.round(o.ms), Math.round(clockOf(g, o.u))])));
t("miss count surfaced", g.wrongThisTurn === 1, String(g.wrongThisTurn));

// Spamming misses can't advance the game.
for (let i = 0; i < 3; i++) {
  actor.s.emit("game_event", { event: "answer", data: { value: -1 } });
  await wait(250);
}
g = cs[0].game();
t("spam cannot pass the turn", g.turnUserId === holder);
t("spam is all counted", g.wrongThisTurn === 4, String(g.wrongThisTurn));

// ---------- the first-rotation cap ----------
// Solve slowly so there is a big share to hand out; capped players must not
// exceed the 30s start while the first lap is unfinished.
g = cs[0].game();
const solver = cs.find((c) => c.id === g.turnUserId);
await wait(2200);
solver.s.emit("game_event", { event: "answer", data: { value: g.prompt * g.settings.multiplier } });
await wait(700);
g = cs[0].game();
t("nobody exceeds the start during the first lap",
  g.players.every((p) => p.ms <= 30_050), JSON.stringify(g.players.map((p) => Math.round(p.ms))));
t("turn advanced after a correct answer", g.turnUserId !== solver.id);
t("turnsTaken counted", g.turnsTaken >= 1, String(g.turnsTaken));

// Finish the lap.
for (let i = 0; i < 3; i++) {
  g = cs[0].game();
  if (g.phase !== "playing") break;
  const who = cs.find((c) => c.id === g.turnUserId);
  if (!who) break;
  await wait(1800);
  who.s.emit("game_event", { event: "answer", data: { value: g.prompt * g.settings.multiplier } });
  await wait(600);
  if (cs[0].game().firstRotationDone) break;
}
g = cs[0].game();
t("first rotation completes", g.firstRotationDone === true, String(g.firstRotationDone));

// Past the lap a slow answer may now push someone above the start.
const preLift = cs[0].game();
const lifter = cs.find((c) => c.id === preLift.turnUserId);
if (lifter && preLift.phase === "playing") {
  const others = preLift.players.filter((p) => p.userId !== lifter.id).map((p) => ({ u: p.userId, ms: p.ms }));
  await wait(2500);
  lifter.s.emit("game_event", { event: "answer", data: { value: preLift.prompt * preLift.settings.multiplier } });
  await wait(700);
  const post = cs[0].game();
  t("shares still pay out after the lap",
    others.some((o) => clockOf(post, o.u) > o.ms),
    JSON.stringify(others.map((o) => [Math.round(o.ms), Math.round(clockOf(post, o.u))])));
}

cs.forEach((c) => c.s.disconnect());
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
