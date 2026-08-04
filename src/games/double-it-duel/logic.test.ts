import {
  DEFAULT_SETTINGS,
  MAX_TURNS,
  SETTING_LIMITS,
  clampSettings,
  createDuel,
  currentPlayer,
  forfeit,
  nextTurnIndex,
  resolveTurn,
  start,
  target,
  timeInPlay,
  timeOut,
  type DuelState,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const half = () => 0.5;

function playing(ids: string[], settings = DEFAULT_SETTINGS): DuelState {
  return start(createDuel(ids, settings, half), half);
}
const clockOf = (s: DuelState, id: string) => s.players.find((p) => p.userId === id)!.clock;

// --- settings validation ---
t("defaults are ×2 / 30s / 1s abyss",
  DEFAULT_SETTINGS.multiplier === 2 &&
    DEFAULT_SETTINGS.startSeconds === 30 &&
    DEFAULT_SETTINGS.abyssSeconds === 1);
t("multiplier must be 2..9", clampSettings({ multiplier: 7 as never }).multiplier === 7);
t("rejects multiplier 1", clampSettings({ multiplier: 1 as never }).multiplier === 2);
t("rejects multiplier 10", clampSettings({ multiplier: 10 as never }).multiplier === 2);
t("start seconds clamped low", clampSettings({ startSeconds: 1 }).startSeconds === SETTING_LIMITS.startSeconds.min);
t("start seconds clamped high", clampSettings({ startSeconds: 9999 }).startSeconds === SETTING_LIMITS.startSeconds.max);
t("start seconds rounded", clampSettings({ startSeconds: 30.7 }).startSeconds === 31);
t("abyss clamped low — never zero", clampSettings({ abyssSeconds: 0 }).abyssSeconds === SETTING_LIMITS.abyssSeconds.min);
t("abyss rejects negatives", clampSettings({ abyssSeconds: -5 }).abyssSeconds === SETTING_LIMITS.abyssSeconds.min);
t("abyss clamped high", clampSettings({ abyssSeconds: 99 }).abyssSeconds === SETTING_LIMITS.abyssSeconds.max);
t("abyss snaps to quarter seconds", clampSettings({ abyssSeconds: 1.3 }).abyssSeconds === 1.25);
t("NaN ignored", clampSettings({ startSeconds: NaN }).startSeconds === 30);
t("garbage ignored", clampSettings({ startSeconds: "x" as never }).startSeconds === 30);

// --- setup ---
let s = createDuel(["a", "b", "c"], { multiplier: 3, startSeconds: 30, abyssSeconds: 1 }, half);
t("starts in lobby", s.phase === "lobby");
t("everyone gets the same clock", s.players.every((p) => p.clock === 30));
t("everyone alive", s.players.every((p) => p.alive));
t("one player can't start", start(createDuel(["a"], DEFAULT_SETTINGS, half), half).phase === "lobby");
s = start(s, half);
t("start moves to playing", s.phase === "playing");
t("turn begins with the first player", currentPlayer(s)!.userId === "a");
t("target respects the multiplier", target(s) === s.prompt * 3);

// --- a correct answer passes time on ---
s = playing(["a", "b", "c"]);
const promptA = s.prompt;
s = resolveTurn(s, "a", promptA * 2, 5); // ×2 default, took 5s
t("answering correctly keeps you alive", s.players[0].alive);
t("your clock pays the full time taken", near(clockOf(s, "a"), 25), String(clockOf(s, "a")));
// 5s taken − 1s abyss = 4s split between b and c = 2s each
t("opponents each gain (took − abyss)/others", near(clockOf(s, "b"), 32) && near(clockOf(s, "c"), 32),
  `${clockOf(s, "b")} / ${clockOf(s, "c")}`);
t("turn passes to the next player", currentPlayer(s)!.userId === "b");
t("solved counted", s.players[0].solved === 1);
t("lastTurn narrates the hand-off",
  s.lastTurn?.userId === "a" && near(s.lastTurn.gaveEach, 2) && s.lastTurn.correct);
t("a new prompt is drawn", typeof s.prompt === "number");

// --- the abyss really does swallow time ---
t("total time in play strictly decreased", timeInPlay(s) < 90, String(timeInPlay(s)));
t("exactly the abyss was lost", near(timeInPlay(s), 89), String(timeInPlay(s)));

// --- overflow above the starting clock is allowed ---
s = playing(["a", "b"], { multiplier: 2, startSeconds: 30, abyssSeconds: 1 });
s = resolveTurn(s, "a", s.prompt * 2, 21); // hands 20s to b
t("clocks may exceed the starting amount", clockOf(s, "b") > 30, String(clockOf(s, "b")));
t("overflow is exact", near(clockOf(s, "b"), 50), String(clockOf(s, "b")));

// --- a fast answer costs almost nothing but gives nothing away ---
s = playing(["a", "b", "c"]);
s = resolveTurn(s, "a", s.prompt * 2, 0.4); // faster than the abyss
t("answering under the abyss gives opponents nothing",
  near(clockOf(s, "b"), 30) && near(clockOf(s, "c"), 30), `${clockOf(s, "b")}`);
t("but still costs you the time", near(clockOf(s, "a"), 29.6), String(clockOf(s, "a")));

// --- wrong answers and timeouts eliminate ---
s = playing(["a", "b", "c"]);
s = resolveTurn(s, "a", s.prompt * 2 + 1, 3);
t("a wrong answer eliminates you", !s.players[0].alive);
t("cause recorded as wrong", s.players[0].eliminatedBy === "wrong");
t("elimination doesn't end a 3-player game", s.phase === "playing", s.phase);
t("turn moves off the eliminated player", currentPlayer(s)!.alive);
t("a wrong answer passes nothing on", near(clockOf(s, "b"), 30));

s = playing(["a", "b"]);
s = timeOut(s, "a");
t("running out eliminates", !s.players[0].alive && s.players[0].eliminatedBy === "time");
t("last player standing wins", s.phase === "over" && s.winner === "b");
t("win tallied", s.wins["b"] === 1);

// --- burning past your own clock is a timeout, not a pass ---
s = playing(["a", "b"], { multiplier: 2, startSeconds: 10, abyssSeconds: 1 });
s = resolveTurn(s, "a", s.prompt * 2, 12); // correct, but too slow
t("correct but over your clock still eliminates", !s.players[0].alive);
t("cause is time, not wrong", s.players[0].eliminatedBy === "time");
t("clock floors at zero", clockOf(s, "a") === 0);
t("opponent gains nothing from a timeout", near(clockOf(s, "b"), 10), String(clockOf(s, "b")));

// --- out-of-turn answers are ignored ---
s = playing(["a", "b", "c"]);
const before = JSON.stringify(s);
t("answering out of turn is a no-op", JSON.stringify(resolveTurn(s, "b", s.prompt * 2, 1)) === before);
t("timing out someone else is a no-op", JSON.stringify(timeOut(s, "c")) === before);

// --- leaving forfeits ---
s = playing(["a", "b", "c"]);
s = forfeit(s, "b", half); // not their turn
t("a leaver is eliminated", !s.players[1].alive);
t("game continues with 2 left", s.phase === "playing");
t("turn holder unchanged when someone else leaves", currentPlayer(s)!.userId === "a");
s = forfeit(s, "a", half); // now the turn holder leaves
t("last remaining player wins", s.phase === "over" && s.winner === "c");

// --- turn rotation skips the dead ---
const roster = [
  { userId: "a", clock: 5, alive: true, solved: 0 },
  { userId: "b", clock: 5, alive: false, solved: 0 },
  { userId: "c", clock: 5, alive: true, solved: 0 },
];
t("rotation skips eliminated players", nextTurnIndex(roster, 0) === 2);
t("rotation wraps around", nextTurnIndex(roster, 2) === 0);

// --- termination: the whole point of the abyss ---
{
  // Everyone answers correctly, always, as fast as possible. Even then the pool
  // drains and somebody eventually runs out.
  let g = playing(["a", "b", "c", "d"], { multiplier: 2, startSeconds: 30, abyssSeconds: 1 });
  const startPool = timeInPlay(g);
  let guard = 0;
  let prevPool = startPool;
  let monotonic = true;
  while (g.phase === "playing" && guard++ < 5000) {
    const who = currentPlayer(g)!;
    g = resolveTurn(g, who.userId, target(g), 1.5);
    const pool = timeInPlay(g);
    if (pool > prevPool + 1e-9) monotonic = false;
    prevPool = pool;
  }
  t("a perfect-play game still ends", g.phase === "over", `${g.phase} after ${guard} turns`);
  t("time in play never increases", monotonic);
  t("pool shrank from the start", timeInPlay(g) < startPool);
  t("guard not hit", guard < 5000, String(guard));
}

// --- the turn cap is a real backstop ---
{
  let g = playing(["a", "b"], { multiplier: 2, startSeconds: 180, abyssSeconds: 0.25 });
  // Answer instantly forever: the drain per turn is a quarter second.
  let guard = 0;
  while (g.phase === "playing" && guard++ < MAX_TURNS + 50) {
    const who = currentPlayer(g)!;
    g = resolveTurn(g, who.userId, target(g), 0.01);
  }
  t("turn cap ends a stalemate", g.phase === "over", `${g.phase} turns=${g.turns}`);
  t("cap declares a winner or a draw", g.winner === null || typeof g.winner === "string");
}

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
