/**
 * Land Grab over real sockets.
 *
 * Covers what the pure-logic tests structurally can't: that the game is actually
 * registered, that the tick loop runs, that the run-length-encoded grid decodes to
 * the right size, that host-only rules are enforced, and — the one that matters
 * most here — that server.js's duplicated copy of the rules agrees with logic.ts.
 *
 * Start a server yourself first:
 *   SESSION_SECRET=localtestsecret NODE_ENV=production PORT=3090 node server.js
 */
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO, "node_modules/socket.io-client/build/esm/index.js")
);
const URL = process.env.BASE || `http://localhost:${process.env.PORT || "3090"}`;
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
  return c;
}

/** Decode the run-length encoded grid the server sends. */
function unpack(rle, size) {
  const out = new Array(size).fill(0);
  let at = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    for (let n = 0; n < rle[i + 1] && at < size; n++) out[at++] = rle[i];
  }
  return { grid: out, filled: at };
}

const A = crypto.randomUUID(), B = crypto.randomUUID();
const a = client(A), b = client(B);
await wait(800);
a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(600);
const code = a.joined.roomCode;
b.s.emit("join_room", { roomCode: code, name: "Ben" });
await wait(600);

// ---------- the game is registered and selectable ----------
a.s.emit("select_game", { game: "territory" });
await wait(700);
t("territory is a registered game", a.last()?.game === "territory", String(a.last()?.game));
t("it has state", !!a.game(), JSON.stringify(a.game())?.slice(0, 80));
t("it opens in waiting", a.game()?.phase === "waiting", String(a.game()?.phase));
t("both players are in it", (a.game()?.players ?? []).length === 2,
  (a.game()?.players ?? []).length);
t("the guest sees it too", b.last()?.game === "territory");

// ---------- the grid arrives RLE-encoded and decodes cleanly ----------
{
  const g = a.game();
  const size = g.cols * g.rows;
  const { grid, filled } = unpack(g.grid, size);
  t("the encoded grid is shorter than the raw one", g.grid.length < size,
    `${g.grid.length} vs ${size}`);
  t("it decodes to exactly the board size", filled === size, `${filled} vs ${size}`);
  t("every player's opening block is on the grid",
    g.players.every((p) => p.cells === 9), g.players.map((p) => p.cells));
  t("the decoded grid contains both owners",
    grid.includes(1) && grid.includes(2));
  t("owned cell count matches the decoded grid",
    grid.filter((v) => v === 1).length === g.players[0].cells,
    [grid.filter((v) => v === 1).length, g.players[0].cells]);
  t("claimable excludes walls", g.claimable <= size, [g.claimable, size]);
}

// ---------- settings are host-only and validated ----------
b.errors.length = 0;
const mapBefore = a.game()?.settings?.mapName;
b.s.emit("game_event", { event: "settings", data: { mapName: "The Pillar" } });
await wait(500);
t("a non-host cannot change settings", a.game()?.settings?.mapName === mapBefore,
  String(a.game()?.settings?.mapName));

a.s.emit("game_event", { event: "settings", data: { mapName: "The Pillar" } });
await wait(500);
t("the host can pick a map", a.game()?.settings?.mapName === "The Pillar",
  String(a.game()?.settings?.mapName));
t("the map name is offered as an option",
  (a.game()?.options?.mapNames ?? []).includes("The Pillar"),
  JSON.stringify(a.game()?.options?.mapNames));

a.s.emit("game_event", { event: "settings", data: { mapName: "Nonexistent Map" } });
await wait(400);
t("a bogus map is refused", a.game()?.settings?.mapName === "The Pillar",
  String(a.game()?.settings?.mapName));

a.s.emit("game_event", { event: "settings", data: { roundSeconds: 9999 } });
await wait(400);
t("a bogus round length is refused",
  (a.game()?.options?.roundSeconds ?? []).includes(a.game()?.settings?.roundSeconds),
  String(a.game()?.settings?.roundSeconds));

a.s.emit("game_event", { event: "settings", data: { roundSeconds: 60 } });
await wait(400);
t("a valid round length is accepted", a.game()?.settings?.roundSeconds === 60,
  String(a.game()?.settings?.roundSeconds));

a.s.emit("game_event", { event: "settings", data: { raidingAllowed: false } });
await wait(400);
t("raiding can be turned off", a.game()?.settings?.raidingAllowed === false);
a.s.emit("game_event", { event: "settings", data: { raidingAllowed: true } });
await wait(400);
t("and back on", a.game()?.settings?.raidingAllowed === true);

// ---------- starting runs a real countdown, then a real tick loop ----------
b.errors.length = 0;
b.s.emit("game_event", { event: "start" });
await wait(500);
t("a non-host cannot start", a.game()?.phase === "waiting", String(a.game()?.phase));

a.s.emit("game_event", { event: "start" });
await wait(600);
t("starting enters the countdown", a.game()?.phase === "countdown", String(a.game()?.phase));
t("the countdown begins at 3", a.game()?.countdown === 3, String(a.game()?.countdown));

// The countdown must take ~3 REAL seconds, not 3 ticks. At 110ms a tick-based
// countdown would be gone in a third of a second — Snake had exactly this bug.
const startedAt = Date.now();
for (let i = 0; i < 60 && a.game()?.phase === "countdown"; i++) await wait(100);
const countdownMs = Date.now() - startedAt;
t("the countdown lasts about 3 seconds", countdownMs > 2200 && countdownMs < 4500,
  `${countdownMs}ms`);
t("then it's playing", a.game()?.phase === "playing", String(a.game()?.phase));

// ---------- the tick loop actually advances ----------
const tick1 = a.game()?.tick ?? 0;
await wait(1200);
const tick2 = a.game()?.tick ?? 0;
t("the tick loop is running", tick2 > tick1, `${tick1} -> ${tick2}`);
t("the round clock is counting down", (a.game()?.secondsLeft ?? 0) < 60,
  String(a.game()?.secondsLeft));
t("spawn protection is reported", (a.game()?.protectedTicks ?? -1) >= 0,
  String(a.game()?.protectedTicks));

// ---------- turning is accepted and validated ----------
{
  a.errors.length = 0;
  a.s.emit("game_event", { event: "turn", data: { dir: { x: 0, y: -1 } } });
  await wait(400);
  t("a legal turn is accepted without error", a.errors.length === 0, JSON.stringify(a.errors));

  // A crafted direction must not teleport anyone.
  const at = { ...(a.game()?.players?.find((p) => p.userId === a.joined.userId)?.at ?? {}) };
  a.s.emit("game_event", { event: "turn", data: { dir: { x: 9, y: 9 } } });
  await wait(600);
  const now = a.game()?.players?.find((p) => p.userId === a.joined.userId)?.at;
  t("an illegal direction cannot teleport",
    Math.abs((now?.x ?? 0) - (at.x ?? 0)) <= 12 && Math.abs((now?.y ?? 0) - (at.y ?? 0)) <= 12,
    [at, now]);
}

// ---------- players claim ground by moving ----------
{
  // Drive in a small square: out of the block and back, which must close a loop.
  const dirs = [
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
  ];
  let grew = false;
  const startCells = a.game()?.players?.find((p) => p.userId === a.joined.userId)?.cells ?? 0;
  for (let lap = 0; lap < 6 && !grew; lap++) {
    for (const dir of dirs) {
      a.s.emit("game_event", { event: "turn", data: { dir } });
      await wait(500);
    }
    const cells = a.game()?.players?.find((p) => p.userId === a.joined.userId)?.cells ?? 0;
    if (cells > startCells) grew = true;
  }
  t("driving a loop claims ground", grew,
    `${startCells} -> ${a.game()?.players?.find((p) => p.userId === a.joined.userId)?.cells}`);
  t("nobody exceeds the claimable board",
    (a.game()?.players ?? []).reduce((n, p) => n + p.cells, 0) <= (a.game()?.claimable ?? 0),
    [(a.game()?.players ?? []).map((p) => p.cells), a.game()?.claimable]);
}

// ---------- pause freezes the tick AND preserves the round clock ----------
{
  a.s.emit("pause_game");
  await wait(600);
  t("the room reports paused", !!a.last()?.paused, JSON.stringify(a.last()?.paused));
  const frozenTick = a.game()?.tick;
  const frozenClock = a.game()?.secondsLeft;
  await wait(1500);
  t("the tick is frozen", a.game()?.tick === frozenTick, `${frozenTick} -> ${a.game()?.tick}`);
  // ticksLeft is a COUNT, not a deadline, precisely so a pause can't eat the round.
  t("the round clock did not drain while paused", a.game()?.secondsLeft === frozenClock,
    `${frozenClock} -> ${a.game()?.secondsLeft}`);

  a.s.emit("resume_game");
  await wait(1200);
  t("resuming clears the pause", !a.last()?.paused);
  t("and the tick moves again", (a.game()?.tick ?? 0) > frozenTick,
    `${frozenTick} -> ${a.game()?.tick}`);
}

// ---------- the round ends on the clock, and the room counts the win ----------
{
  // 60s is the shortest option, so drop straight to the end via a fresh short round.
  // Wait it out rather than reaching into state: the point is that the SERVER ends it.
  const deadline = Date.now() + 75_000;
  while (a.game()?.phase === "playing" && Date.now() < deadline) await wait(1000);
  t("the round ended on its own", a.game()?.phase === "over", String(a.game()?.phase));
  t("standings were produced", (a.game()?.standings ?? []).length === 2,
    JSON.stringify(a.game()?.standings));
  t("standings are sorted by held ground",
    (a.game()?.standings ?? []).every((s, i, arr) => i === 0 || arr[i - 1].cells >= s.cells),
    JSON.stringify(a.game()?.standings?.map((s) => s.cells)));

  const winner = a.game()?.winner;
  if (winner) {
    t("the room banked the win", (a.last()?.roomWins?.[winner] ?? 0) === 1,
      JSON.stringify(a.last()?.roomWins));
  } else {
    // A tie must crown nobody rather than picking whoever sorted first.
    t("a draw banks no win", Object.keys(a.last()?.roomWins ?? {}).length === 0,
      JSON.stringify(a.last()?.roomWins));
  }
}

// ---------- rematch ----------
{
  b.errors.length = 0;
  b.s.emit("game_event", { event: "again" });
  await wait(500);
  t("a non-host cannot rematch", a.game()?.phase === "over", String(a.game()?.phase));

  a.s.emit("game_event", { event: "again" });
  await wait(700);
  t("the host can rematch",
    a.game()?.phase === "countdown" || a.game()?.phase === "playing", String(a.game()?.phase));
  t("a rematch resets the board",
    (a.game()?.players ?? []).every((p) => p.cells === 9), (a.game()?.players ?? []).map((p) => p.cells));
  t("and the round clock", (a.game()?.secondsLeft ?? 0) > 50, String(a.game()?.secondsLeft));
}

a.s.disconnect(); b.s.disconnect();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
