import {
  MULTIPLIERS,
  MIN_MS,
  START_MS,
  STEP_MS,
  DEFAULT_MULTIPLIER,
  isMultiplier,
  allowedMsForRound,
  createGame,
  target,
  isCorrect,
  submit,
  timeOut,
  score,
  boardSlug,
  type Multiplier,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};

// --- multiplier set ---
t("offers ×2 through ×9", MULTIPLIERS.join(",") === "2,3,4,5,6,7,8,9");
t("default is ×2 (still 'Double It!')", DEFAULT_MULTIPLIER === 2);
t("isMultiplier accepts 2..9", MULTIPLIERS.every((m) => isMultiplier(m)));
t("isMultiplier rejects 1", !isMultiplier(1));
t("isMultiplier rejects 10", !isMultiplier(10));
t("isMultiplier rejects 0 and negatives", !isMultiplier(0) && !isMultiplier(-3));
t("isMultiplier rejects fractions", !isMultiplier(2.5));

// --- timer curve is unchanged by the multiplier ---
t("round 1 allows 10s", allowedMsForRound(1) === START_MS);
t("round 2 allows 9.9s", allowedMsForRound(2) === START_MS - STEP_MS);
t("clock floors at MIN_MS", allowedMsForRound(500) === MIN_MS);

// --- target respects the multiplier ---
for (const m of MULTIPLIERS) {
  const g = createGame(m, () => 0); // prompt = MIN_NUMBER = 1
  t(`×${m}: target is prompt × ${m}`, target(g) === g.prompt * m, `${target(g)} vs ${g.prompt * m}`);
}

// --- createGame ---
let g = createGame(5, () => 0.5);
t("createGame stores the multiplier", g.multiplier === 5);
t("createGame starts at round 1", g.round === 1);
t("createGame is playing", g.status === "playing");
t("defaults to ×2 with no arg", createGame().multiplier === 2);

// --- correctness is multiplier-aware ---
t("×2: 50 -> 100 correct", isCorrect(50, 2, 100));
t("×2: 50 -> 150 wrong", !isCorrect(50, 2, 150));
t("×3: 50 -> 150 correct", isCorrect(50, 3, 150));
t("×9: 11 -> 99 correct", isCorrect(11, 9, 99));
t("×9: 11 -> 22 wrong (that's ×2)", !isCorrect(11, 9, 22));

// --- submit advances / ends ---
g = createGame(7, () => 0.5);
const good = submit(g, g.prompt * 7);
t("×7: correct answer advances", good.status === "playing" && good.round === 2);
t("multiplier carries to the next round", good.multiplier === 7);
const bad = submit(g, g.prompt * 7 + 1);
t("×7: wrong answer ends the run", bad.status === "lost" && bad.lostTo === "wrong");
t("wrong answer records what was typed", bad.lastAnswer === g.prompt * 7 + 1);
t("submit ignored once lost", submit(bad, bad.prompt * 7).status === "lost");

// answering as if it were ×2 fails on a ×5 game
g = createGame(5, () => 0.5);
t("×5: doubling is not enough", submit(g, g.prompt * 2).status === "lost");

// --- timeout + score ---
t("timeOut ends the run", timeOut(createGame(4)).lostTo === "time");
t("timeOut ignored once lost", timeOut(bad).lostTo === "wrong");
g = createGame(3, () => 0.5);
t("fresh game scores 0", score(g) === 0);
let g2 = submit(g, g.prompt * 3);
g2 = submit(g2, g2.prompt * 3);
t("two clears score 2", score(g2) === 2);

// --- board slugs are distinct per multiplier ---
const slugs = MULTIPLIERS.map(boardSlug);
t("each multiplier gets a distinct board slug", new Set(slugs).size === slugs.length);
t("slug format is double-it:Nx", boardSlug(9 as Multiplier) === "double-it:9x");
t("slug is namespaced under double-it", slugs.every((s) => s.startsWith("double-it:")));

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
