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
s = createDuel(["a", "b", "c"], settings({ abyssSeconds: 1 }), 0, zero);
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

// Overflow above the starting clock is allowed on purpose.
s = createDuel(["a", "b"], settings({ startSeconds: 30, abyssSeconds: 1 }), 0, zero);
after = solve(s, 20_000);
t("clocks may overflow the starting max", ms(after, "b") === 49_000, String(ms(after, "b")));

// Answering faster than the abyss DRAINS the opponents.
s = createDuel(["a", "b"], settings({ abyssSeconds: 3 }), 0, zero);
after = solve(s, 500);
t("a fast answer takes time off opponents", ms(after, "b") === 27_500, String(ms(after, "b")));
t("and barely costs the answerer", ms(after, "a") === 29_500, String(ms(after, "a")));

// --- wrong answers ---
s = createDuel(["a", "b"], settings(), 0, zero);
const wrongPrompt = s.prompt;
let wrong = answer(s, "a", target(s) + 1, 4_000, zero);
t("a wrong answer is not correct", !wrong.correct);
t("wrong still costs the time spent", ms(wrong.state, "a") === 26_000, String(ms(wrong.state, "a")));
t("wrong does NOT eliminate you", wrong.state.players[0].alive);
t("the same prompt passes on after a wrong answer", wrong.state.prompt === wrongPrompt,
  `${wrong.state.prompt} vs ${wrongPrompt}`);
t("turn still moves on a wrong answer", activePlayer(wrong.state)!.userId === "b");

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
