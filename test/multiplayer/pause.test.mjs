import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve the repo from this file, so the suite runs from any checkout.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO_ROOT, "node_modules/socket.io-client/build/esm/index.js")
);

// Accept PORT like the sibling suites do. Reading only BASE meant a PORT=... run
// silently pointed at the default and every assertion failed on a null join.
const URL = process.env.BASE || `http://localhost:${process.env.PORT || "3050"}`;
let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const s = io(URL, { transports: ["websocket"] });
  const c = { s, name, states: [], errors: [], joined: null };
  s.on("room_state", (st) => c.states.push(st));
  s.on("room_error", (e) => c.errors.push(e.message));
  s.on("joined", (j) => { c.joined = j; });
  c.last = () => c.states[c.states.length - 1];
  c.game = () => c.last()?.gameState;
  c.paused = () => c.last()?.paused;
  return c;
}

// ---------- Double It Duel: the clock must actually freeze ----------
const cs = ["Ana", "Ben"].map(client);
await wait(700);
cs[0].s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(500);
const code = cs[0].joined.roomCode;
cs[1].s.emit("join_room", { roomCode: code, name: "Ben" });
await wait(400);

cs[0].s.emit("select_game", { game: "double-it-duel" });
await wait(400);
cs[0].s.emit("game_event", { event: "settings", data: { startSeconds: 60, abyssSeconds: 1 } });
await wait(350);
cs[0].s.emit("game_event", { event: "start" });
await wait(500);
t("duel started", cs[0].game()?.phase === "playing");
t("not paused at first", cs[0].paused() == null, JSON.stringify(cs[0].paused()));

// A non-host cannot pause.
const nonHost = cs.find((c) => !c.joined.isHost);
nonHost.errors.length = 0;
nonHost.s.emit("pause_game");
await wait(400);
t("non-host cannot pause", cs[0].paused() == null);
t("non-host is told why", nonHost.errors.some((m) => /only the host/i.test(m)),
  JSON.stringify(nonHost.errors));

// Let the active clock burn, then pause.
const turnUser = cs[0].game().turnUserId;
await wait(1500);
const beforePause = cs[0].game().players.find((p) => p.userId === turnUser).ms;
cs[0].s.emit("pause_game");
await wait(500);
t("host paused the game", cs[0].paused() != null, JSON.stringify(cs[0].paused()));
t("pause records who did it", cs[0].paused()?.by === cs[0].joined.userId);
t("pause reason is host", cs[0].paused()?.reason === "host");
t("both clients see the pause", cs[1].paused() != null);

// The frozen clock must not move at all across a long wait.
const atPause = cs[0].game().players.find((p) => p.userId === turnUser).ms;
await wait(2500);
const afterWait = cs[0].game().players.find((p) => p.userId === turnUser).ms;
t("frozen clock does not tick", Math.abs(afterWait - atPause) < 50,
  `${Math.round(atPause)} -> ${Math.round(afterWait)}`);
t("elapsed time was banked, not refunded", atPause < beforePause + 50,
  `before=${Math.round(beforePause)} atPause=${Math.round(atPause)}`);

// Game events are refused while paused.
const actor = cs.find((c) => c.joined.userId === turnUser);
actor.errors.length = 0;
actor.s.emit("game_event", { event: "answer", data: { value: 1 } });
await wait(400);
t("answers refused while paused", actor.errors.some((m) => /paused/i.test(m)),
  JSON.stringify(actor.errors));
t("still paused after a refused answer", cs[0].paused() != null);

// Resume: host only, and the clock must pick up where it stopped.
nonHost.errors.length = 0;
nonHost.s.emit("resume_game");
await wait(400);
t("non-host cannot resume", cs[0].paused() != null);
t("non-host told why", nonHost.errors.some((m) => /only the host/i.test(m)));

cs[0].s.emit("resume_game");
await wait(400);
t("host resumed", cs[0].paused() == null);
const atResume = cs[0].game().players.find((p) => p.userId === turnUser).ms;
t("resume does not refund the paused turn", Math.abs(atResume - atPause) < 400,
  `${Math.round(atPause)} -> ${Math.round(atResume)}`);
await wait(1200);
const ticking = cs[0].game().players.find((p) => p.userId === turnUser).ms;
t("clock runs again after resume", ticking < atResume - 800,
  `${Math.round(atResume)} -> ${Math.round(ticking)}`);

// An answer works again once resumed.
const g = cs[0].game();
const nowActor = cs.find((c) => c.joined.userId === g.turnUserId);
nowActor.s.emit("game_event", { event: "answer", data: { value: g.prompt * g.settings.multiplier } });
await wait(600);
t("answers accepted after resume", cs[0].game().lastEvent?.kind === "correct",
  JSON.stringify(cs[0].game().lastEvent));

cs.forEach((c) => c.s.disconnect());
await wait(300);

// ---------- Snake: the tick must stop ----------
const sn = ["A", "B"].map(client);
await wait(700);
sn[0].s.emit("join_room", { roomCode: "NEW", name: "A" });
await wait(500);
const sCode = sn[0].joined.roomCode;
sn[1].s.emit("join_room", { roomCode: sCode, name: "B" });
await wait(400);
sn[0].s.emit("select_game", { game: "snake-duel" });
await wait(400);
sn[0].s.emit("game_event", { event: "start" });
// Past the 3-2-1 countdown, not just past the first tick. This waited 1200ms back
// when the countdown ran at tick speed (~0.5s); once it was fixed to real seconds
// that landed mid-countdown, where tick is legitimately still 0.
await wait(4200);
t("snake finished counting down", sn[0].game()?.phase === "playing", String(sn[0].game()?.phase));
t("snake running", (sn[0].game()?.tick ?? 0) > 0, String(sn[0].game()?.tick));

sn[0].s.emit("pause_game");
await wait(400);
const tickAtPause = sn[0].game().tick;
await wait(2000);
t("snake tick frozen while paused", sn[0].game().tick === tickAtPause,
  `${tickAtPause} -> ${sn[0].game().tick}`);

sn[0].s.emit("resume_game");
await wait(1200);
t("snake tick resumes", sn[0].game().tick > tickAtPause,
  `${tickAtPause} -> ${sn[0].game().tick}`);
sn.forEach((c) => c.s.disconnect());
await wait(300);

// ---------- Codenames: pausable with no timers at all ----------
const cn = ["A", "B"].map(client);
await wait(700);
cn[0].s.emit("join_room", { roomCode: "NEW", name: "A" });
await wait(500);
const cCode = cn[0].joined.roomCode;
cn[1].s.emit("join_room", { roomCode: cCode, name: "B" });
await wait(400);
cn[0].s.emit("select_game", { game: "codenames" });
await wait(400);
cn[0].s.emit("game_event", { event: "start" });
await wait(400);
cn[0].s.emit("pause_game");
await wait(400);
t("codenames pauses without pause hooks", cn[0].paused() != null, JSON.stringify(cn[0].paused()));
cn[0].errors.length = 0;
cn[0].s.emit("game_event", { event: "submit", data: { word: "anything" } });
await wait(400);
t("codenames submissions refused while paused",
  cn[0].errors.some((m) => /paused/i.test(m)), JSON.stringify(cn[0].errors));
cn[0].s.emit("resume_game");
await wait(400);
t("codenames resumes", cn[0].paused() == null);
cn[0].s.emit("game_event", { event: "submit", data: { word: "harmony" } });
await wait(500);
t("codenames accepts a word after resume",
  cn[0].game()?.submitted?.length === 1, JSON.stringify(cn[0].game()?.submitted));
cn.forEach((c) => c.s.disconnect());

console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
