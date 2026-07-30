import type { Dir } from "./logic";
import {
  COLS,
  MAX_PLAYERS,
  SPAWN_PROTECT_TICKS,
  pickSpawns,
  isProtected,
  ROWS,
  DIRS,
  MAX_TICKS,
  createDuel,
  queueTurn,
  step,
  duelScore,
  placeFood,
  occupied,
  type DuelState,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};

const zero = () => 0;

/**
 * Skip the countdown AND spawn protection, so a test can exercise collisions.
 *
 * Snakes are then placed on known, well-separated rows. Spawns are random now,
 * and a constant rng of 0 puts every snake on the SAME cell — so tests that care
 * about collisions must position them explicitly rather than trust the spawn.
 *
 * Setting tick directly rather than stepping keeps the board where the test put
 * it; stepping would move every snake while the clock ran down.
 */
function playing(ids = ["a", "b"]): DuelState {
  let s = createDuel(ids, zero);
  while (s.phase === "countdown") s = step(s, zero);
  s = { ...s, tick: SPAWN_PROTECT_TICKS };
  // Row 2, 6, 10, ... each heading right, far apart and clear of the walls.
  s.snakes.forEach((_, i) => {
    const y = 2 + i * 4;
    s = place(s, i, [
      { x: 4, y },
      { x: 3, y },
      { x: 2, y },
    ], DIRS.right);
  });
  return s;
}

/** Put a snake exactly where a test needs it, with no food in the way. */
function place(
  s: DuelState,
  i: number,
  body: { x: number; y: number }[],
  dir: Dir = DIRS.right,
): DuelState {
  const snakes = s.snakes.map((sn, j) => (j === i ? { ...sn, body, dir, queued: [] } : sn));
  return { ...s, snakes, food: [] };
}

// --- setup ---
let s = createDuel(["a", "b"], zero);
t("two snakes spawned", s.snakes.length === 2);
t("starts in countdown", s.phase === "countdown");
// Spawns are random, so with a constant rng they legitimately coincide. Real
// separation is asserted in the free-for-all section with a real rng.
t("two snakes have bodies", s.snakes.every((sn) => sn.body.length === 3));
t("each snake is 3 long", s.snakes.every((sn) => sn.body.length === 3));
t("food placed", s.food.length === 3);
t("food never on a snake", s.food.every((f) => !occupied(s).some((c) => c.x === f.x && c.y === f.y)));
t("one player waits", createDuel(["a"], zero).phase === "waiting");
t("both start alive", s.snakes.every((sn) => sn.alive));

// --- countdown ---
s = step(s, zero);
t("countdown ticks down", s.countdown === 2 && s.phase === "countdown");
s = step(s, zero);
s = step(s, zero);
t("countdown reaches playing", s.phase === "playing", s.phase);

// --- movement ---
s = playing();
const beforeHead = { ...s.snakes[0].body[0] };
s = step(s, zero);
t("snake advanced", s.snakes[0].body[0].x !== beforeHead.x || s.snakes[0].body[0].y !== beforeHead.y);
t("length preserved without food", s.snakes[0].body.length === 3);
t("tick counted", s.tick === SPAWN_PROTECT_TICKS + 1);

// --- reversal rejected ---
s = playing();
s = queueTurn(s, "a", DIRS.left); // snake a starts heading right
s = step(s, zero);
t("reversal rejected, still alive", s.snakes[0].alive);
t("direction unchanged by reversal", s.snakes[0].dir.x === 1);

// --- rapid double turn must not fold the snake ---
s = playing();
s = queueTurn(s, "a", DIRS.up);
s = queueTurn(s, "a", DIRS.left);
s = step(s, zero);
s = step(s, zero);
t("rapid double turn survives", s.snakes[0].alive);

// --- wall death ---
s = playing();
s = place(s, 0, [
  { x: COLS - 1, y: 5 },
  { x: COLS - 2, y: 5 },
  { x: COLS - 3, y: 5 },
]);
s = step(s, zero);
t("wall kills", !s.snakes[0].alive);
t("cause recorded as wall", s.snakes[0].causeOfDeath === "wall");
t("survivor wins", s.phase === "over" && s.winner === "b", `${s.phase}/${s.winner}`);
t("win tallied", s.wins["b"] === 1);

// --- tail tip is NOT a collision (it vacates the same tick) ---
s = playing();
// Park the other snake far away: the helper seats it on row 6, which is exactly
// where this test's tail tip sits, and it would register as a head-on instead.
s = place(s, 1, [
  { x: 20, y: 20 },
  { x: 19, y: 20 },
  { x: 18, y: 20 },
], DIRS.right);
s = place(
  s,
  0,
  [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ],
  DIRS.down,
);
s = step(s, zero);
t("moving into a vacating tail tip is legal", s.snakes[0].alive, String(s.snakes[0].causeOfDeath));

// --- self collision ---
// Aim at a MID-body segment. Targeting the tail tip would be legal, since the
// tip vacates on the same tick — that is the case just above.
s = playing();
s = place(
  s,
  0,
  [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 4 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
  ],
  DIRS.up,
);
// head {5,5} moving up -> {5,4}, which is index 3 of 7: not the tail.
s = step(s, zero);
t("running into own body kills", !s.snakes[0].alive && s.snakes[0].causeOfDeath === "self",
  String(s.snakes[0].causeOfDeath));

// --- head-on is a draw ---
s = playing();
s = place(s, 0, [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], DIRS.right);
s = place(s, 1, [{ x: 7, y: 10 }, { x: 8, y: 10 }, { x: 9, y: 10 }], DIRS.left);
s = step(s, zero);
t("head-on kills both", s.snakes.every((sn) => !sn.alive));
t("head-on is a draw", s.phase === "over" && s.winner === null);
t("head-on cause recorded", s.snakes.every((sn) => sn.causeOfDeath === "head-on"));
t("draw does not tally a win", Object.keys(s.wins).length === 0);

// --- crashing into the opponent ---
s = playing();
s = place(s, 0, [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], DIRS.right);
// b blocks a's path at {6,10} while moving somewhere safe itself. Its head is
// index 0 and it travels right, so its own next cell is empty board.
s = place(s, 1, [
  { x: 6, y: 8 },
  { x: 6, y: 9 },
  { x: 6, y: 10 },
  { x: 6, y: 11 },
  { x: 6, y: 12 },
], DIRS.right);
s = step(s, zero);
t("hitting the opponent kills only the crasher", !s.snakes[0].alive && s.snakes[1].alive,
  `${s.snakes[0].alive}/${s.snakes[1].alive}`);
t("cause recorded as opponent", s.snakes[0].causeOfDeath === "opponent", String(s.snakes[0].causeOfDeath));
t("opponent wins", s.winner === "b");

// --- eating ---
s = playing();
s = place(s, 0, [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], DIRS.right);
s = { ...s, food: [{ x: 6, y: 10 }] };
const lenBefore = s.snakes[0].body.length;
s = step(s, zero);
t("eating scores", s.snakes[0].score === 1);
t("eating grows", s.snakes[0].body.length === lenBefore + 1);
t("board is topped back up", s.food.length === 3, String(s.food.length));

// --- score for the leaderboard ---
s = playing();
s = { ...s, phase: "over", winner: "a", snakes: s.snakes.map((sn) => ({ ...sn, score: 4 })) };
t("winner gets a bonus", duelScore(s, "a") === 9, String(duelScore(s, "a")));
t("loser gets food only", duelScore(s, "b") === 4);
t("unknown player scores 0", duelScore(s, "nobody") === 0);

// --- guards ---
s = playing();
const over: DuelState = { ...s, phase: "over" };
t("step after over is a no-op", step(over, zero).tick === over.tick);
t("turns ignored once over", queueTurn(over, "a", DIRS.up).snakes[0].queued.length === 0);
t("queue capped at 2", (() => {
  let q = playing();
  q = queueTurn(q, "a", DIRS.up);
  q = queueTurn(q, "a", DIRS.right);
  q = queueTurn(q, "a", DIRS.down);
  return q.snakes[0].queued.length <= 2;
})());

// --- stalemate cap ---
s = playing();
// Keep them apart so the stalemate is judged on score, not on a crash.
s = { ...s, tick: MAX_TICKS, snakes: s.snakes.map((sn, i) => ({ ...sn, score: i === 0 ? 9 : 2 })) };
s = step(s, zero);
t("stalemate ends the duel", s.phase === "over");
t("longest snake wins a stalemate", s.winner === "a", String(s.winner));

// --- placeFood never overlaps ---
const taken = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
const spots = placeFood(taken, 5, Math.random);
t("placeFood avoids taken cells", spots.every((f) => !taken.some((c) => c.x === f.x && c.y === f.y)));
t("placeFood returns distinct cells", new Set(spots.map((f) => `${f.x},${f.y}`)).size === spots.length);
t("placeFood respects the board", spots.every((f) => f.x >= 0 && f.x < COLS && f.y >= 0 && f.y < ROWS));

// --- free-for-all: N players ---
const many = ["a", "b", "c", "d", "e"];
let ffa = createDuel(many, Math.random);
t("5 players all spawn", ffa.snakes.length === 5);
t("player cap enforced",
  createDuel(Array.from({ length: 20 }, (_, i) => `p${i}`), Math.random).snakes.length === MAX_PLAYERS);

// Random spawns, not fixed corners: two boards should differ.
const seedsDiffer = (() => {
  for (let i = 0; i < 40; i++) {
    const one = createDuel(["a", "b"], Math.random).snakes[0].body[0];
    const two = createDuel(["a", "b"], Math.random).snakes[0].body[0];
    if (one.x !== two.x || one.y !== two.y) return true;
  }
  return false;
})();
t("spawns are random, not fixed", seedsDiffer);

const spawns = pickSpawns(6, Math.random);
t("spawns stay off the walls",
  spawns.every((sp) => sp.at.x >= 2 && sp.at.x < COLS - 2 && sp.at.y >= 2 && sp.at.y < ROWS - 2),
  JSON.stringify(spawns.map((sp) => sp.at)));
t("spawn bodies fit on the board", (() => {
  const g = createDuel(many, Math.random);
  return g.snakes.every((sn) =>
    sn.body.every((c) => c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS));
})());
t("no two snakes share a cell at spawn", (() => {
  for (let i = 0; i < 25; i++) {
    const g = createDuel(many, Math.random);
    const cells = g.snakes.flatMap((sn) => sn.body).map((c) => `${c.x},${c.y}`);
    if (new Set(cells).size !== cells.length) return false;
  }
  return true;
})());

// --- spawn protection ---
let prot = createDuel(["a", "b"], zero);
while (prot.phase === "countdown") prot = step(prot, zero);
t("protection active at the start", isProtected(prot));
// Drive two snakes head-on while shielded: both must survive.
prot = place(prot, 0, [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], DIRS.right);
prot = place(prot, 1, [{ x: 7, y: 10 }, { x: 8, y: 10 }, { x: 9, y: 10 }], DIRS.left);
prot = { ...prot, tick: 0 };
prot = step(prot, zero);
t("head-on is survivable while protected", prot.snakes.every((sn) => sn.alive),
  JSON.stringify(prot.snakes.map((sn) => sn.causeOfDeath)));
t("round continues during protection", prot.phase === "playing");

// A wall still kills while protected — the window is not consequence-free.
let wallProt = createDuel(["a", "b"], zero);
while (wallProt.phase === "countdown") wallProt = step(wallProt, zero);
wallProt = place(wallProt, 0, [
  { x: COLS - 1, y: 5 },
  { x: COLS - 2, y: 5 },
  { x: COLS - 3, y: 5 },
]);
wallProt = { ...wallProt, tick: 0 };
wallProt = step(wallProt, zero);
t("walls still kill while protected", !wallProt.snakes[0].alive);
t("cause is wall", wallProt.snakes[0].causeOfDeath === "wall");

// Once it expires, snake-vs-snake is lethal again.
let expired = createDuel(["a", "b"], zero);
while (expired.phase === "countdown") expired = step(expired, zero);
expired = place(expired, 0, [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }], DIRS.right);
expired = place(expired, 1, [{ x: 7, y: 10 }, { x: 8, y: 10 }, { x: 9, y: 10 }], DIRS.left);
expired = { ...expired, tick: SPAWN_PROTECT_TICKS };
expired = step(expired, zero);
t("head-on kills once protection lapses", expired.snakes.every((sn) => !sn.alive));
t("that is a draw", expired.winner === null && expired.phase === "over");

// --- elimination, not instant end, with 3+ players ---
let three3 = playing(["a", "b", "c"]);
three3 = place(three3, 0, [
  { x: COLS - 1, y: 5 },
  { x: COLS - 2, y: 5 },
  { x: COLS - 3, y: 5 },
]);
three3 = step(three3, zero);
t("one death eliminates but does not end a 3-player round",
  !three3.snakes[0].alive && three3.phase === "playing", three3.phase);
t("two survivors remain", three3.snakes.filter((sn) => sn.alive).length === 2);

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
