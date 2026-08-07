import {
  DEFAULT_SETTINGS,
  MULTIPLIERS,
  activePlayer,
  answer,
  cleanSettings,
  createDuel,
  expireTurn,
  remainingMs,
  target,
  totalMs,
  type DuelSettings,
  type DuelState,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};

const zero = () => 0;
const settings = (over: Partial<DuelSettings> = {}): DuelSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

/** Answer correctly, taking `spentMs` to do it. */
function solve(s: DuelState, spentMs: number): DuelState {
  const who = activePlayer(s)!.userId;
  return answer(s, who, target(s), s.turnStartedAt + spentMs, zero).state;
}

const ms = (s: DuelState, id: string) => s.players.find((p) => p.userId === id)!.ms;

// --- setup ---
let s = createDuel(["a", "b", "c"], settings(), 0, zero);
t("three players seated", s.players.length === 3);
t("everyone starts with the same clock", s.players.every((p) => p.ms === 30_000));
t("starts playing with 2+", s.phase === "playing");
t("one player waits in lobby", createDuel(["a"], settings(), 0, zero).phase === "lobby");
t("first player is on turn", activePlayer(s)!.userId === "a");
t("target respects the multiplier", target(createDuel(["a", "b"], settings({ multiplier: 7 }), 0, zero)) ===
  createDuel(["a", "b"], settings({ multiplier: 7 }), 0, zero).prompt * 7);

// --- the clock transfer ---
// a spends 5s with abyss=1: a loses 5s, and 4s splits between b and c (2s each).
// Started mid-game (turnsTaken preset) so the first-rotation cap isn't the thing
// under test here — the raw arithmetic is.
s = {
  ...createDuel(["a", "b", "c"], settings({ abyssSeconds: 1 }), 0, zero),
  turnsTaken: 3,
};
let after = solve(s, 5_000);
t("answerer pays what they spent", ms(after, "a") === 25_000, String(ms(after, "a")));
t("opponents split spent-minus-abyss", ms(after, "b") === 32_000 && ms(after, "c") === 32_000,
  `${ms(after, "b")} / ${ms(after, "c")}`);
t("turn passes to the next player", activePlayer(after)!.userId === "b");
t("a new prompt is dealt", after.prompt !== undefined);
t("solve is counted", after.players.find((p) => p.userId === "a")!.solved === 1);

// Exactly `abyss` seconds leave the table per turn — the termination guarantee.
t("abyss destroys exactly its amount",
  totalMs(s) - totalMs(after) === 1_000, `${totalMs(s)} -> ${totalMs(after)}`);

// --- the first rotation is capped at the starting clock ---
// With two players, a's turn IS the first rotation completing, so b is capped.
s = createDuel(["a", "b"], settings({ startSeconds: 30, abyssSeconds: 1 }), 0, zero);
after = solve(s, 20_000);
t("no overflow while the first rotation is unfinished", ms(after, "b") === 30_000,
  String(ms(after, "b")));

// Once everyone has had a turn the cap lifts. Proven by comparing the SAME
// transfer before and after the rotation completes: a player sitting at the
// starting clock gains nothing while capped, and gains normally afterwards.
{
  const cfg = settings({ startSeconds: 30, abyssSeconds: 1 });
  // During the lap: b is at 30s, so a 19s share is thrown away by the cap.
  let capped = createDuel(["a", "b", "c"], cfg, 0, zero);
  capped = solve(capped, 20_000);
  t("a full clock gains nothing while capped", ms(capped, "b") === 30_000,
    String(ms(capped, "b")));

  // After the lap: the identical situation now pays out.
  let free = { ...createDuel(["a", "b", "c"], cfg, 0, zero), turnsTaken: 3 };
  free = solve(free, 20_000);
  t("the same share pays out after the first lap", ms(free, "b") > 30_000,
    String(ms(free, "b")));
  t("and it can exceed the starting clock", ms(free, "b") === 39_500,
    String(ms(free, "b")));
}

// Three players: the cap must hold for the whole first lap, not just turn one.
{
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 30, abyssSeconds: 1 }), 0, zero);
  g = solve(g, 20_000);              // turn 1 of 3
  t("3p: nobody over the start after turn 1",
    g.players.every((p) => p.ms <= 30_000), JSON.stringify(g.players.map((p) => p.ms)));
  g = solve(g, 20_000);              // turn 2 of 3
  t("3p: still nobody over the start after turn 2",
    g.players.every((p) => p.ms <= 30_000), JSON.stringify(g.players.map((p) => p.ms)));
  g = solve(g, 20_000);              // turn 3 completes the rotation
  t("3p: rotation complete", g.turnsTaken === 3, String(g.turnsTaken));
  // Beyond the lap the cap no longer applies. Everyone has spent by now, so the
  // check is that the cap is not being enforced rather than that a clock is high.
  const beforeLift = ms(g, "b");
  g = solve(g, 20_000);              // turn 4 — cap is off
  t("3p: shares still pay out after the lap", ms(g, "b") > beforeLift,
    `${Math.round(beforeLift)} -> ${Math.round(ms(g, "b"))}`);
}

// The cap must not refund a DRAIN. A fast answer still takes time off people
// during the first rotation — capping only limits gains.
{
  let g = createDuel(["a", "b"], settings({ startSeconds: 30, abyssSeconds: 3 }), 0, zero);
  g = solve(g, 500);                 // faster than the abyss, so b loses time
  t("a fast answer still drains during the first rotation", ms(g, "b") < 30_000,
    String(ms(g, "b")));
}

// An elimination still advances the rotation, so the cap can't be held open by
// someone going out on their first turn.
{
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 10 }), 0, zero);
  // Guess slowly enough to burn the whole clock on turn 1.
  g = answer(g, "a", -1, g.turnStartedAt + 6_000, zero).state;
  g = answer(g, "a", -1, g.turnStartedAt + 6_000, zero).state;   // a out on turn 1
  t("elimination counts as a completed turn", g.turnsTaken === 1, String(g.turnsTaken));
}

// Answering faster than the abyss DRAINS the opponents.
s = createDuel(["a", "b"], settings({ abyssSeconds: 3 }), 0, zero);
after = solve(s, 500);
t("a fast answer takes time off opponents", ms(after, "b") === 27_500, String(ms(after, "b")));
t("and barely costs the answerer", ms(after, "a") === 29_500, String(ms(after, "a")));

// --- wrong answers: you keep the turn, and the clock is the only cost ---
s = createDuel(["a", "b"], settings(), 0, zero);
const wrongPrompt = s.prompt;
let wrong = answer(s, "a", target(s) + 1, 4_000, zero);
t("a wrong answer is not correct", !wrong.correct);
t("a miss costs exactly the time spent", ms(wrong.state, "a") === 26_000,
  String(ms(wrong.state, "a")));
t("wrong does NOT eliminate you outright", wrong.state.players[0].alive);
t("YOU KEEP THE TURN after a miss", activePlayer(wrong.state)!.userId === "a",
  activePlayer(wrong.state)!.userId);
t("the number does not change after a miss", wrong.state.prompt === wrongPrompt,
  `${wrong.state.prompt} vs ${wrongPrompt}`);
t("a miss shares nothing with opponents", ms(wrong.state, "b") === 30_000,
  String(ms(wrong.state, "b")));
t("misses on the number are counted", wrong.state.wrongThisTurn === 1);

// The exploit this closes: a miss used to pass the turn on AND still share out
// (spent - abyss), so instant garbage drained everyone else for nearly nothing.
{
  let g = createDuel(["a", "b"], settings({ startSeconds: 30 }), 0, zero);
  const oppBefore = ms(g, "b");
  // Five instant wrong answers — no time spent on any of them.
  for (let i = 0; i < 5; i++) {
    g = answer(g, "a", -1, g.turnStartedAt, zero).state;
  }
  t("spamming wrong answers never passes the turn", activePlayer(g)!.userId === "a");
  t("spamming wrong answers gives opponents nothing", ms(g, "b") === oppBefore,
    `${oppBefore} -> ${ms(g, "b")}`);
  t("five misses are all counted", g.wrongThisTurn === 5, String(g.wrongThisTurn));
  // Instant guesses are free of themselves — the real cost is that the clock is
  // running while you make them, which a zero-elapsed test can't show.
  t("instant guesses cost no wall time", ms(g, "a") === 30_000, String(ms(g, "a")));
}

// Realistically, guessing burns your clock because thinking takes time.
{
  let g = createDuel(["a", "b"], settings({ startSeconds: 30 }), 0, zero);
  // Three guesses, 2s apart. Each charges only the time since the last attempt,
  // so the total is the wall time spent, not 3x anything.
  g = answer(g, "a", -1, g.turnStartedAt + 2_000, zero).state;
  g = answer(g, "a", -2, g.turnStartedAt + 2_000, zero).state;
  g = answer(g, "a", -3, g.turnStartedAt + 2_000, zero).state;
  t("each guess charges only the time since the last one", ms(g, "a") === 24_000,
    String(ms(g, "a")));
  t("still on turn after three misses", activePlayer(g)!.userId === "a");
}

// Getting it right afterwards clears the miss counter and passes the turn.
{
  let g = createDuel(["a", "b"], settings(), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt + 500, zero).state;
  t("still on turn after one miss", activePlayer(g)!.userId === "a");
  g = answer(g, "a", target(g), g.turnStartedAt + 1_000, zero).state;
  t("a correct answer finally passes the turn", activePlayer(g)!.userId === "b");
  t("the miss counter resets on a solve", g.wrongThisTurn === 0);
  t("the solve is credited", g.players.find((p) => p.userId === "a")!.solved === 1);
}

// Guessing until the clock empties still eliminates you — the clock is the only
// currency, and it is enough.
{
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 10 }), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt + 6_000, zero).state;
  t("survives the first slow miss", g.players[0].alive, String(ms(g, "a")));
  g = answer(g, "a", -1, g.turnStartedAt + 6_000, zero).state;
  t("burning the clock on guesses eliminates you", !g.players[0].alive, String(ms(g, "a")));
  t("elimination still assigns a place", g.players[0].place === 3);
  t("and the turn moves on", activePlayer(g)!.userId !== "a");
}

// --- out of turn ---
s = createDuel(["a", "b"], settings(), 0, zero);
const outOfTurn = answer(s, "b", target(s), 1_000, zero);
t("answering out of turn is ignored", outOfTurn.state === s);

// --- running the clock out ---
s = createDuel(["a", "b", "c"], settings({ startSeconds: 10 }), 0, zero);
let dead = answer(s, "a", target(s), 10_001, zero);
t("overspending your clock eliminates you", !dead.state.players[0].alive);
t("elimination assigns a place", dead.state.players[0].place === 3, String(dead.state.players[0].place));
t("game continues with two left", dead.state.phase === "playing");
t("timeout is recorded", dead.state.lastEvent?.kind === "timeout");

// expireTurn: the server's tick, when nobody submits at all
s = createDuel(["a", "b"], settings({ startSeconds: 5 }), 0, zero);
t("expireTurn does nothing early", expireTurn(s, 4_000, zero) === s);
const expired = expireTurn(s, 5_000, zero);
t("expireTurn eliminates on zero", !expired.players[0].alive);
t("last player standing wins", expired.phase === "over" && expired.winner === "b",
  `${expired.phase}/${expired.winner}`);
t("winner takes first place", expired.players.find((p) => p.userId === "b")!.place === 1);

// --- a fast player can close a game out ---
// Two players, abyss 3s, b never answers: a answering instantly drains b.
s = createDuel(["a", "b"], settings({ startSeconds: 10, abyssSeconds: 3 }), 0, zero);
let guard = 0;
while (s.phase === "playing" && guard++ < 100) {
  const who = activePlayer(s)!.userId;
  if (who === "a") {
    s = solve(s, 100); // a is instant
  } else {
    s = solve(s, 2_000); // b dawdles
  }
}
t("a duel actually terminates", s.phase === "over", `phase=${s.phase} after ${guard} turns`);
t("someone won", s.winner !== null, String(s.winner));

// Even with everyone playing identically, the abyss forces an end.
s = createDuel(["a", "b", "c", "d"], settings({ startSeconds: 15, abyssSeconds: 1 }), 0, zero);
guard = 0;
const startTotal = totalMs(s);
while (s.phase === "playing" && guard++ < 5_000) s = solve(s, 1_000);
t("terminates with four equal players", s.phase === "over", `after ${guard} turns`);
t("total time strictly decreased", totalMs(s) < startTotal, `${startTotal} -> ${totalMs(s)}`);

// --- remainingMs reflects the running turn ---
s = createDuel(["a", "b"], settings({ startSeconds: 30 }), 1_000, zero);
t("active player's clock ticks down", remainingMs(s, "a", 4_000) === 27_000,
  String(remainingMs(s, "a", 4_000)));
t("idle player's clock is frozen", remainingMs(s, "b", 4_000) === 30_000);
t("clock never reads below zero", remainingMs(s, "a", 999_999) === 0);
t("unknown player reads zero", remainingMs(s, "nobody", 4_000) === 0);

// --- settings validation ---
t("defaults on junk", (() => {
  const c = cleanSettings({ multiplier: 99, startSeconds: 9999, abyssSeconds: -5 });
  return c.multiplier === 2 && c.startSeconds === 30 && c.abyssSeconds === 1;
})());
t("accepts allowed values", (() => {
  const c = cleanSettings({ multiplier: 9, startSeconds: 60, abyssSeconds: 5 });
  return c.multiplier === 9 && c.startSeconds === 60 && c.abyssSeconds === 5;
})());
t("unknown settings keys are ignored",
  Object.keys(cleanSettings({ nonsense: 1 })).length === 3,
  JSON.stringify(cleanSettings({ nonsense: 1 })));
t("rejects off-list start times", cleanSettings({ startSeconds: 31 }).startSeconds === 30);
t("rejects non-object", cleanSettings(null).multiplier === 2 && cleanSettings("x").startSeconds === 30);
t("every multiplier is selectable",
  MULTIPLIERS.every((m) => cleanSettings({ multiplier: m }).multiplier === m));

// --- guards ---
s = createDuel(["a", "b"], settings(), 0, zero);
const over: DuelState = { ...s, phase: "over" };
t("answers ignored once over", answer(over, "a", target(over), 1_000, zero).state === over);
t("expireTurn ignored once over", expireTurn(over, 99_999, zero) === over);

// --- A WRONG ANSWER MUST NOT SWALLOW THE OPPONENTS' TIME ---
//
// The bug: a miss charges the answerer and re-bases `turnStartedAt`, so the
// eventual correct answer only shared `now - turnStartedAt` — the last attempt.
// Every second burned on a wrong guess came off the answerer and reached NOBODY.
// Opponents silently lost time they were owed, which is worse than the reverse:
// the pot is how this duel ends, so quietly shrinking it stalls the whole game.
//
// NOTE: every case here plays past the first rotation first. During rotation one
// opponents are capped at their starting clock, so a gain of 0 is CORRECT there
// and would mask the bug entirely — an earlier version of these tests "passed"
// against the broken code for exactly that reason.

/** Play one clean rotation so the first-rotation gain cap has lifted. */
function pastFirstRotation(ids: string[], over: Partial<DuelSettings> = {}): DuelState {
  let g = createDuel(ids, settings(over), 0, zero);
  for (let i = 0; i < ids.length; i++) g = solve(g, 1_000);
  return g;
}

{
  const over = { startSeconds: 30, abyssSeconds: 1 };

  // Baseline: one clean 9s answer with two opponents, cap already lifted.
  let clean = pastFirstRotation(["a", "b", "c"], over);
  t("the cap has lifted", clean.turnsTaken >= 3, String(clean.turnsTaken));
  const whose = activePlayer(clean)!.userId;
  const others = ["a", "b", "c"].filter((id) => id !== whose);
  const cleanBefore = others.map((id) => ms(clean, id));
  clean = solve(clean, 9_000);
  const cleanGain = ms(clean, others[0]) - cleanBefore[0];
  t("baseline: a 9s answer funds each opponent (9-1)/2", Math.round(cleanGain) === 4_000,
    String(cleanGain));

  // The same 9 seconds, split across two wrong guesses and then the right one.
  let messy = pastFirstRotation(["a", "b", "c"], over);
  messy = answer(messy, whose, target(messy) + 1, messy.turnStartedAt + 3_000, zero).state;
  messy = answer(messy, whose, target(messy) + 1, messy.turnStartedAt + 4_000, zero).state;
  messy = answer(messy, whose, target(messy), messy.turnStartedAt + 2_000, zero).state;

  t("the answerer pays the same 9s either way",
    ms(messy, whose) === ms(clean, whose), `${ms(messy, whose)} vs ${ms(clean, whose)}`);
  t("OPPONENTS GET THE SAME TIME whether or not you missed first",
    ms(messy, others[0]) === ms(clean, others[0]),
    `${ms(messy, others[0])} vs ${ms(clean, others[0])}`);
  t("...and so does the third player",
    ms(messy, others[1]) === ms(clean, others[1]),
    `${ms(messy, others[1])} vs ${ms(clean, others[1])}`);
  t("the reported share matches what was handed out",
    Math.round(messy.lastEvent!.sharedMs) === Math.round(cleanGain),
    String(messy.lastEvent?.sharedMs));

  // The abyss is charged ONCE per turn, not once per attempt — otherwise three
  // misses would quietly drain 3x the intended amount off the table.
  const total = messy.players.reduce((n, p) => n + p.ms, 0);
  const cleanTotal = clean.players.reduce((n, p) => n + p.ms, 0);
  t("exactly one abyss is taken per turn, however many misses",
    Math.round(total) === Math.round(cleanTotal), `${total} vs ${cleanTotal}`);
}
{
  // A miss must still fund nobody at the moment it happens: the fix must not turn
  // a wrong guess into an immediate payout.
  const s2 = createDuel(["a", "b"], settings({ startSeconds: 30, abyssSeconds: 1 }), 0, zero);
  const missed = answer(s2, "a", target(s2) + 1, s2.turnStartedAt + 5_000, zero).state;
  t("a miss pays out nothing at the time", ms(missed, "b") === 30_000,
    String(ms(missed, "b")));
  t("but it is remembered for the settle", missed.turnSpentMs === 5_000,
    String(missed.turnSpentMs));
}
{
  // A timeout must NOT leak the dead player's spent time into the next pot.
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 10, abyssSeconds: 1 }), 0, zero);
  g = answer(g, "a", target(g) + 1, g.turnStartedAt + 4_000, zero).state; // miss, 4s banked
  t("time is banked mid-turn", g.turnSpentMs === 4_000, String(g.turnSpentMs));
  g = answer(g, "a", -1, g.turnStartedAt + 60_000, zero).state;           // times out
  t("a timeout clears the accumulator", g.turnSpentMs === 0, String(g.turnSpentMs));
  t("and the turn moved on", activePlayer(g)?.userId !== "a", activePlayer(g)?.userId);
  t("the eliminated player funded nobody", ms(g, "b") === 10_000, String(ms(g, "b")));
}
{
  // Many misses in a row, past the cap: one abyss, and the answerer pays the true
  // total rather than only the final attempt.
  let g = pastFirstRotation(["a", "b"], { startSeconds: 60, abyssSeconds: 2 });
  const who = activePlayer(g)!.userId;
  const foe = who === "a" ? "b" : "a";
  const mineBefore = ms(g, who);
  const foeBefore = ms(g, foe);
  const tableBefore = g.players.reduce((n, p) => n + p.ms, 0);

  for (let i = 0; i < 5; i++) {
    g = answer(g, who, target(g) + 1, g.turnStartedAt + 1_000, zero).state;
  }
  t("five misses banked five seconds", g.turnSpentMs === 5_000, String(g.turnSpentMs));
  g = answer(g, who, target(g), g.turnStartedAt + 1_000, zero).state;

  t("the answerer paid all 6 seconds", mineBefore - ms(g, who) === 6_000,
    String(mineBefore - ms(g, who)));
  t("the opponent got 6 - 2 = 4", ms(g, foe) - foeBefore === 4_000,
    String(ms(g, foe) - foeBefore));
  t("the table lost exactly one abyss",
    tableBefore - g.players.reduce((n, p) => n + p.ms, 0) === 2_000,
    String(tableBefore - g.players.reduce((n, p) => n + p.ms, 0)));
}

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
