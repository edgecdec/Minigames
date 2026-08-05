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
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 10, wrongPenaltySeconds: 5 }), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;   // a out on turn 1
  t("elimination counts as a completed turn", g.turnsTaken === 1, String(g.turnsTaken));
}

// Answering faster than the abyss DRAINS the opponents.
s = createDuel(["a", "b"], settings({ abyssSeconds: 3 }), 0, zero);
after = solve(s, 500);
t("a fast answer takes time off opponents", ms(after, "b") === 27_500, String(ms(after, "b")));
t("and barely costs the answerer", ms(after, "a") === 29_500, String(ms(after, "a")));

// --- wrong answers: you keep the turn and pay for the miss ---
s = createDuel(["a", "b"], settings({ wrongPenaltySeconds: 2 }), 0, zero);
const wrongPrompt = s.prompt;
let wrong = answer(s, "a", target(s) + 1, 4_000, zero);
t("a wrong answer is not correct", !wrong.correct);
// 4s spent + 2s penalty
t("wrong costs the time spent PLUS the penalty", ms(wrong.state, "a") === 24_000,
  String(ms(wrong.state, "a")));
t("wrong does NOT eliminate you outright", wrong.state.players[0].alive);
t("YOU KEEP THE TURN after a miss", activePlayer(wrong.state)!.userId === "a",
  activePlayer(wrong.state)!.userId);
t("the number does not change after a miss", wrong.state.prompt === wrongPrompt,
  `${wrong.state.prompt} vs ${wrongPrompt}`);
t("a miss shares nothing with opponents", ms(wrong.state, "b") === 30_000,
  String(ms(wrong.state, "b")));
t("misses on the number are counted", wrong.state.wrongThisTurn === 1);
t("the miss reports its penalty", wrong.state.lastEvent?.penaltyMs === 2_000,
  String(wrong.state.lastEvent?.penaltyMs));

// The exploit this closes: instant garbage used to be the strongest play,
// because it passed the turn on AND still drained everyone else.
{
  let g = createDuel(["a", "b"], settings({ startSeconds: 30, wrongPenaltySeconds: 2 }), 0, zero);
  const oppBefore = ms(g, "b");
  // Five instant wrong answers in a row.
  for (let i = 0; i < 5; i++) {
    g = answer(g, "a", -1, g.turnStartedAt, zero).state;
  }
  t("spamming wrong answers never passes the turn", activePlayer(g)!.userId === "a");
  t("spamming wrong answers costs the spammer", ms(g, "a") === 30_000 - 5 * 2_000,
    String(ms(g, "a")));
  t("spamming wrong answers gives opponents nothing", ms(g, "b") === oppBefore,
    `${oppBefore} -> ${ms(g, "b")}`);
  t("five misses are all counted", g.wrongThisTurn === 5, String(g.wrongThisTurn));
}

// Getting it right afterwards clears the miss counter and passes the turn.
{
  let g = createDuel(["a", "b"], settings({ wrongPenaltySeconds: 1 }), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;
  t("still on turn after one miss", activePlayer(g)!.userId === "a");
  g = answer(g, "a", target(g), g.turnStartedAt + 1_000, zero).state;
  t("a correct answer finally passes the turn", activePlayer(g)!.userId === "b");
  t("the miss counter resets on a solve", g.wrongThisTurn === 0);
  t("the solve is credited", g.players.find((p) => p.userId === "a")!.solved === 1);
}

// The penalty can eliminate you, which is the real deterrent.
{
  let g = createDuel(["a", "b", "c"], settings({ startSeconds: 10, wrongPenaltySeconds: 5 }), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;      // -5s -> 5s left
  t("survives the first miss", g.players[0].alive, String(ms(g, "a")));
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;      // -5s -> 0 -> out
  t("the penalty can eliminate you", !g.players[0].alive, String(ms(g, "a")));
  t("elimination by penalty still assigns a place", g.players[0].place === 3);
  t("and the turn moves on", activePlayer(g)!.userId !== "a");
}

// A zero penalty keeps guessing free, but you STILL keep the turn — so it can
// never be used to skip a number.
{
  let g = createDuel(["a", "b"], settings({ wrongPenaltySeconds: 0 }), 0, zero);
  g = answer(g, "a", -1, g.turnStartedAt, zero).state;
  t("zero penalty costs nothing extra", ms(g, "a") === 30_000, String(ms(g, "a")));
  t("but the turn is still yours", activePlayer(g)!.userId === "a");
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
t("wrong penalty defaults to 2s", cleanSettings({}).wrongPenaltySeconds === 2);
t("wrong penalty accepts allowed values",
  cleanSettings({ wrongPenaltySeconds: 5 }).wrongPenaltySeconds === 5);
t("wrong penalty rejects off-list values",
  cleanSettings({ wrongPenaltySeconds: 4 }).wrongPenaltySeconds === 2);
t("wrong penalty allows an explicit zero",
  cleanSettings({ wrongPenaltySeconds: 0 }).wrongPenaltySeconds === 0);
t("rejects off-list start times", cleanSettings({ startSeconds: 31 }).startSeconds === 30);
t("rejects non-object", cleanSettings(null).multiplier === 2 && cleanSettings("x").startSeconds === 30);
t("every multiplier is selectable",
  MULTIPLIERS.every((m) => cleanSettings({ multiplier: m }).multiplier === m));

// --- guards ---
s = createDuel(["a", "b"], settings(), 0, zero);
const over: DuelState = { ...s, phase: "over" };
t("answers ignored once over", answer(over, "a", target(over), 1_000, zero).state === over);
t("expireTurn ignored once over", expireTurn(over, 99_999, zero) === over);

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
