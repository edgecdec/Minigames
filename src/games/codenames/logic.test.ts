import {
  roundSyncPoints,
  syncExtremes,
  MIN_PROMPT_WORDS,
  drawStartingWords,
  createState,
  normalizeWord,
  submitWord,
  everyoneSubmitted,
  resolveRound,
  startGame,
  MAX_WORD_LENGTH,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};

const seeded = () => 0; // always the first starting pair

// --- normalizeWord: the whole game hinges on this ---
t("case insensitive", normalizeWord("BOIL") === normalizeWord("boil"));
t("trims whitespace", normalizeWord("  boil  ") === "boil");
t("strips punctuation", normalizeWord("boil!") === "boil");
// Endings are NOT stemmed. A crude stemmer was wrong both ways: it merged words
// players consider distinct, and let unrelated words that happen to stem alike
// register as agreement nobody reached. You match on what you actually typed.
t("gerund is its own word", normalizeWord("boiling") !== normalizeWord("boil"));
t("plural is its own word", normalizeWord("showers") !== normalizeWord("shower"));
t("-ies is not folded", normalizeWord("berries") !== normalizeWord("berry"));
t("-es is not folded", normalizeWord("dishes") !== normalizeWord("dish"));
// Nothing is truncated any more, so the class of bug that produced "hors" and
// "kettl" cannot recur — each word normalises to its own letters.
t("kettles stays kettles", normalizeWord("kettles") === "kettles", normalizeWord("kettles"));
t("horses stays horses", normalizeWord("horses") === "horses", normalizeWord("horses"));
t("boxes stays boxes", normalizeWord("boxes") === "boxes", normalizeWord("boxes"));
t("churches stays churches", normalizeWord("churches") === "churches");
t("glasses stays glasses", normalizeWord("glasses") === "glasses");
// The words the old stemmer mangled worst: these lost their meaning entirely.
t("string is not str", normalizeWord("string") === "string", normalizeWord("string"));
t("spring is not spr", normalizeWord("spring") === "spring", normalizeWord("spring"));
t("bring is not br", normalizeWord("bring") === "bring", normalizeWord("bring"));
// And the false agreement it created: two unrelated words stemming to the same
// thing used to count as the whole group converging.
t("ceiling and ceil are different words",
  normalizeWord("ceiling") !== normalizeWord("ceil"));
t("but casing and spacing still agree",
  normalizeWord("  Ceiling ") === normalizeWord("CEILING"));
t("accents folded", normalizeWord("café") === "cafe");
t("short words unchanged", normalizeWord("gas") === "gas");
t("double-s kept", normalizeWord("glass") === "glass", normalizeWord("glass"));
t("digits dropped", normalizeWord("b0il") === "bil");
t("empty on symbols only", normalizeWord("!!!") === "");

// --- setup ---
let s = createState(seeded);
t("starts in lobby", s.phase === "lobby");
t("defaults to two words", s.words.length === 2 && s.words[0] !== s.words[1]);
t("prompt words pre-banned", s.used.length === 2);
t("round starts at 1", s.round === 1);

s = startGame(s);
t("start moves to submitting", s.phase === "submitting");

// --- submission validation ---
t("rejects empty", submitWord(s, "u1", "   ").error !== undefined);
t("rejects symbols only", submitWord(s, "u1", "###").error !== undefined);
t("rejects overlong", submitWord(s, "u1", "x".repeat(MAX_WORD_LENGTH + 1)).error !== undefined);
t("rejects a word already on screen", submitWord(s, "u1", s.words[0]).error !== undefined);
t("accepts a fresh word", submitWord(s, "u1", "kettle").error === undefined);

// submissions are stored normalised (casing and padding, not stemmed)
s = submitWord(s, "u1", "  Boil ").state;
t("stored normalised", s.submissions["u1"] === "boil", s.submissions["u1"]);

// --- waiting logic ---
t("not everyone in yet", !everyoneSubmitted(s, ["u1", "u2"]));
s = submitWord(s, "u2", "shower").state;
t("everyone submitted", everyoneSubmitted(s, ["u1", "u2"]));

// --- mismatch feeds the next round ---
let next = resolveRound(s, ["u1", "u2"]);
t("mismatch goes straight back to submitting — no reveal phase",
  next.phase === "submitting", next.phase);
t("submitted words become the prompt", next.words.includes("BOIL") && next.words.includes("SHOWER"), next.words.join("/"));
t("round advanced", next.round === 2);
t("submissions cleared", Object.keys(next.submissions).length === 0);
t("still records who said what", (next.lastReveal ?? []).length === 2);
t("both words now banned", next.used.includes("boil") && next.used.includes("shower"));

t("the next round is already open", next.phase === "submitting");

// used words can't be replayed — Petisomon's rule
t("cannot reuse a previous word", submitWord(next, "u1", "BOIL").error !== undefined);
t("nor with different padding", submitWord(next, "u2", " shower ").error !== undefined);
// The flip side of dropping the stemmer: the plural IS a different word now, so
// it is a legal submission rather than a blocked repeat.
t("but the plural is a different, allowed word",
  submitWord(next, "u2", "showers").error === undefined);

// --- agreement wins ---
let win = submitWord(next, "u1", "steam").state;
win = submitWord(win, "u2", " STEAM ").state; // same word, different casing/padding
t("casing and padding still agree", win.submissions["u1"] === win.submissions["u2"]);
win = resolveRound(win, ["u1", "u2"]);
t("agreement -> won", win.phase === "won");
t("winning word recorded", win.winningWord === "STEAM", String(win.winningWord));

// --- 3+ players ---
let three = startGame(createState(seeded));
three = submitWord(three, "a", "alpha").state;
three = submitWord(three, "b", "bravo").state;
three = submitWord(three, "c", "charlie").state;
t("3 players all submitted", everyoneSubmitted(three, ["a", "b", "c"]));
const r3 = resolveRound(three, ["a", "b", "c"]);
// The old behaviour truncated to 2 and silently dropped the third player's
// answer, so the group converged on a prompt one of them never saw.
t("3-way mismatch keeps ALL THREE words", r3.words.length === 3, r3.words.join("/"));
t("every submitted word is on screen",
  ["ALPHA", "BRAVO", "CHARLIE"].every((w) => r3.words.includes(w)), r3.words.join("/"));
t("all three words banned", ["alpha", "bravo", "charlie"].every((w) => r3.used.includes(w)));
let allAgree = startGame(createState(seeded));
allAgree = submitWord(allAgree, "a", "delta").state;
allAgree = submitWord(allAgree, "b", "delta").state;
allAgree = submitWord(allAgree, "c", "Delta").state;
t("unanimous with 3 wins", resolveRound(allAgree, ["a", "b", "c"]).phase === "won");

// --- guards ---
t("submit outside submitting phase rejected", submitWord(createState(seeded), "u1", "x").error !== undefined);
t("resolve with no submissions is a no-op", resolveRound(startGame(createState(seeded)), ["u1"]).phase === "submitting");
t("a won game stays won", win.phase === "won");

// --- N players: convergence is the progress signal ---
let five = startGame(createState(seeded));
// Real distinct words, not word0..word4: normalizeWord strips digits, so those
// would all collapse to "word" and register as a unanimous win.
const FIVE = ["lantern", "harbour", "velvet", "cinder", "meadow"];
["v", "w", "x", "y", "z"].forEach((id, i) => {
  five = submitWord(five, id, FIVE[i]).state;
});
const r5 = resolveRound(five, ["v", "w", "x", "y", "z"]);
t("5 distinct answers -> 5 words", r5.words.length === 5, String(r5.words.length));
t("all five appear on screen",
  FIVE.every((w) => r5.words.includes(w.toUpperCase())), r5.words.join("/"));

// Partial agreement shrinks the prompt: that is how a group closes in.
let conv = startGame(createState(seeded));
conv = submitWord(conv, "a", "amber").state;
conv = submitWord(conv, "b", "amber").state;   // agrees with a
conv = submitWord(conv, "c", "cobalt").state;
conv = submitWord(conv, "d", "cobalt").state;  // agrees with c
const rConv = resolveRound(conv, ["a", "b", "c", "d"]);
t("4 players, 2 opinions -> 2 words", rConv.words.length === 2, rConv.words.join("/"));
t("still shows all four players", (rConv.lastReveal ?? []).length === 4);
t("duplicates collapse rather than repeat",
  new Set(rConv.words).size === rConv.words.length);

// A near miss: 3 of 4 agree.
let near = startGame(createState(seeded));
near = submitWord(near, "a", "ember").state;
near = submitWord(near, "b", "ember").state;
near = submitWord(near, "c", "ember").state;
near = submitWord(near, "d", "frost").state;
const rNear = resolveRound(near, ["a", "b", "c", "d"]);
t("3-of-4 agreement narrows to 2", rNear.words.length === 2, rNear.words.join("/"));
t("not a win while anyone differs", rNear.phase === "submitting", rNear.phase);

// Unanimous at any size wins outright.
let big = startGame(createState(seeded));
["p", "q", "r", "s", "t2", "u2"].forEach((id) => {
  big = submitWord(big, id, "unison").state;
});
const rBig = resolveRound(big, ["p", "q", "r", "s", "t2", "u2"]);
t("6 players unanimous wins", rBig.phase === "won" && rBig.winningWord === "UNISON");

// No repeats, however many players — every word from every round stays banned.
let noRep = startGame(createState(seeded));
noRep = submitWord(noRep, "a", "onyx").state;
noRep = submitWord(noRep, "b", "pearl").state;
noRep = submitWord(noRep, "c", "quartz").state;
noRep = resolveRound(noRep, ["a", "b", "c"]);
t("all three prior answers barred",
  ["onyx", "pearl", "quartz"].every((w) => submitWord(noRep, "a", w).error !== undefined));
t("a word on screen is barred too",
  submitWord(noRep, "a", noRep.words[0]).error !== undefined);
t("a fresh word is still allowed", submitWord(noRep, "a", "topaz").error === undefined);

// --- the opening prompt is one word per player ---
t("2 players -> 2 words", createState(Math.random, 2).words.length === 2);
t("3 players -> 3 words", createState(Math.random, 3).words.length === 3);
t("4 players -> 4 words", createState(Math.random, 4).words.length === 4);
t("6 players -> 6 words", createState(Math.random, 6).words.length === 6);
t("1 player floors at 2", createState(Math.random, 1).words.length === MIN_PROMPT_WORDS);
t("0 players floors at 2", createState(Math.random, 0).words.length === MIN_PROMPT_WORDS);

t("opening words are distinct", (() => {
  for (let i = 0; i < 60; i++) {
    const w = createState(Math.random, 6).words;
    if (new Set(w).size !== w.length) return false;
  }
  return true;
})(), "a duplicate prompt word would be banned on sight and unwinnable");

t("every opening word is pre-banned", (() => {
  const st = createState(Math.random, 5);
  return st.words.every((w) => st.used.includes(normalizeWord(w)));
})());

t("an opening word cannot be submitted", (() => {
  const st = startGame(createState(Math.random, 4));
  return st.words.every((w) => submitWord(st, "u1", w).error !== undefined);
})());

t("draw never exceeds the pool", drawStartingWords(500, Math.random).length <= 40);
t("draw is distinct at pool scale", (() => {
  const w = drawStartingWords(40, Math.random);
  return new Set(w).size === w.length;
})());

// The full arc for four players: 4 words -> converge -> 1 word wins.
let arc = startGame(createState(Math.random, 4));
t("arc starts on 4 words", arc.words.length === 4, String(arc.words.length));
arc = submitWord(arc, "a", "signal").state;
arc = submitWord(arc, "b", "signal").state;
arc = submitWord(arc, "c", "beacon").state;
arc = submitWord(arc, "d", "lantern").state;
arc = resolveRound(arc, ["a", "b", "c", "d"]);
t("4 words narrow to 3", arc.words.length === 3, arc.words.join("/"));
arc = submitWord(arc, "a", "torch").state;
arc = submitWord(arc, "b", "torch").state;
arc = submitWord(arc, "c", "torch").state;
arc = submitWord(arc, "d", "flare").state;
arc = resolveRound(arc, ["a", "b", "c", "d"]);
t("3 words narrow to 2", arc.words.length === 2, arc.words.join("/"));
arc = submitWord(arc, "a", "ember").state;
arc = submitWord(arc, "b", "ember").state;
arc = submitWord(arc, "c", "ember").state;
arc = submitWord(arc, "d", "ember").state;
arc = resolveRound(arc, ["a", "b", "c", "d"]);
t("converging on 1 word wins", arc.phase === "won" && arc.winningWord === "EMBER",
  `${arc.phase}/${arc.winningWord}`);

// --- sync points ---
// The worked example: 3 say hawaii, 1 says france, 1 says china.
const hawaii = roundSyncPoints(
  { a: "hawaii", b: "hawaii", c: "hawaii", d: "france", e: "china" },
  ["a", "b", "c", "d", "e"],
);
t("3 matching players each score 2",
  hawaii.a === 2 && hawaii.b === 2 && hawaii.c === 2, JSON.stringify(hawaii));
t("lone answers score 0", hawaii.d === 0 && hawaii.e === 0, JSON.stringify(hawaii));
t("you don't score for your own word", !Object.values(hawaii).includes(3));

// Unanimous pays the maximum: players - 1 each.
const unan = roundSyncPoints({ a: "x", b: "x", c: "x", d: "x" }, ["a", "b", "c", "d"]);
t("unanimous with 4 pays 3 each",
  Object.values(unan).every((v) => v === 3), JSON.stringify(unan));

// All different pays nothing.
const none = roundSyncPoints({ a: "p", b: "q", c: "r" }, ["a", "b", "c"]);
t("all-different pays 0", Object.values(none).every((v) => v === 0));

// Two pairs each score 1.
const pairs = roundSyncPoints({ a: "m", b: "m", c: "n", d: "n" }, ["a", "b", "c", "d"]);
t("two pairs score 1 each", Object.values(pairs).every((v) => v === 1), JSON.stringify(pairs));

// Non-submitters are absent rather than zeroed, so they can't be "least in sync".
const partial = roundSyncPoints({ a: "z", b: "z" }, ["a", "b", "c"]);
t("a player who didn't answer is omitted", !("c" in partial), JSON.stringify(partial));

// Normalised words count as the same answer.
let syncState = startGame(createState(Math.random, 3));
syncState = submitWord(syncState, "a", "steam").state;
syncState = submitWord(syncState, "b", "STEAM").state;
syncState = submitWord(syncState, "c", "frost").state;
const syncRes = resolveRound(syncState, ["a", "b", "c"]);
t("different spellings still count as sync",
  syncRes.lastRoundSync?.a === 1 && syncRes.lastRoundSync?.b === 1,
  JSON.stringify(syncRes.lastRoundSync));
t("the odd one out scores 0", syncRes.lastRoundSync?.c === 0);

// Points accumulate across rounds.
let acc = syncRes;
acc = submitWord(acc, "a", "amber").state;
acc = submitWord(acc, "b", "amber").state;
acc = submitWord(acc, "c", "amber").state;
acc = resolveRound(acc, ["a", "b", "c"]);
t("points accumulate", acc.syncPoints.a === 3, JSON.stringify(acc.syncPoints));
t("laggard catches up when they agree", acc.syncPoints.c === 2, JSON.stringify(acc.syncPoints));

// Extremes, with ties returned together.
const ext = syncExtremes({ a: 5, b: 5, c: 1 });
t("most in sync handles ties", ext?.most.length === 2 && ext.high === 5, JSON.stringify(ext));
t("least in sync identified", ext?.least.join() === "c" && ext.low === 1);
t("no players -> null", syncExtremes({}) === null);
t("everyone level: most and least are all", (() => {
  const e = syncExtremes({ a: 2, b: 2 });
  return e?.most.length === 2 && e?.least.length === 2;
})());

// --- the count is bounded, not monotonic ---
// A real five-player game can thrash: 5 -> 3 -> 5 -> 4 -> 2 -> 1. Asserting the
// count only ever falls would be wrong, and framing it as "progress" misleads.
{
  const ids5 = ["a", "b", "c", "d", "e"];
  let g5 = startGame(createState(Math.random, 5));
  const trail: number[] = [g5.words.length];
  const playRound = (words: string[]) => {
    ids5.forEach((id, i) => {
      g5 = submitWord(g5, id, words[i]).state;
    });
    g5 = resolveRound(g5, ids5);
    trail.push(g5.words.length);
  };

  playRound(["alpha", "alpha", "alpha", "bravo", "charlie"]); // 3 distinct
  t("5 players narrow to 3", trail[1] === 3, trail.join("->"));
  playRound(["delta", "echo", "foxtrot", "golf", "hotel"]); // all 5 differ
  t("count climbs back to 5", trail[2] === 5, trail.join("->"));
  t("widening is detectable", g5.prevWordCount === 3, String(g5.prevWordCount));
  playRound(["india", "india", "juliet", "kilo", "lima"]); // 4 distinct
  t("then down to 4", trail[3] === 4, trail.join("->"));
  playRound(["mike", "mike", "mike", "mike", "november"]); // 2 distinct
  t("then down to 2", trail[4] === 2, trail.join("->"));
  playRound(["oscar", "oscar", "oscar", "oscar", "oscar"]); // unanimous
  t("unanimous finally wins", g5.phase === "won" && g5.winningWord === "OSCAR",
    `${g5.phase}/${g5.winningWord}`);
  t("the count went UP at least once",
    trail.some((n, i) => i > 0 && n > trail[i - 1]), trail.join("->"));
  t("count never exceeds the player count", trail.every((n) => n <= 5), trail.join("->"));
  t("a win collapses the prompt to one word", g5.words.length === 1, g5.words.join("/"));
  t("the winning word is the one on screen", g5.words[0] === g5.winningWord);
}

// --- game counter: a rematch must be distinguishable from the first game ---
t("a new game starts at gameNumber 1", createState(Math.random, 3).gameNumber === 1);
t("gameNumber survives a resolve", (() => {
  let g = startGame(createState(Math.random, 2));
  g = submitWord(g, "a", "alpha").state;
  g = submitWord(g, "b", "bravo").state;
  return resolveRound(g, ["a", "b"]).gameNumber === 1;
})());
// The win key the UI builds must differ between game 1 and game 2 even though
// `round` restarts at 1 — otherwise a rematch win looks already-celebrated and
// the confetti is suppressed. Build it the same way the component does.
const winKey = (gameNumber: number, round: number) => `won-${gameNumber}-${round}`;
t("win key includes the game number", winKey(2, 1) === "won-2-1");
t("same round in a later game yields a different key",
  winKey(1, 1) !== winKey(2, 1), `${winKey(1, 1)} vs ${winKey(2, 1)}`);
t("same game and round yields a stable key", winKey(3, 4) === winKey(3, 4));

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);

// --- authorship: who put each word up ---
// The reveal screen used to carry this. Now it sits above the words themselves,
// which is what let the pause between rounds go away entirely.
{
  let a = startGame(createState(seeded, 3));
  t("the opening prompt has no authors — it came from the pool",
    Object.keys(a.authors).length === 0, JSON.stringify(a.authors));

  a = submitWord(a, "p1", "anchor").state;
  a = submitWord(a, "p2", "anchor").state;   // agrees with p1
  a = submitWord(a, "p3", "compass").state;
  a = resolveRound(a, ["p1", "p2", "p3"]);

  t("every word on screen has an author",
    a.words.every((w) => (a.authors[w] ?? []).length > 0),
    JSON.stringify(a.authors));
  t("agreeing players SHARE a word's authorship",
    (a.authors["ANCHOR"] ?? []).slice().sort().join() === "p1,p2",
    JSON.stringify(a.authors["ANCHOR"]));
  t("a lone answer has exactly one author",
    (a.authors["COMPASS"] ?? []).join() === "p3", JSON.stringify(a.authors["COMPASS"]));
  t("authors are keyed by the DISPLAYED word",
    Object.keys(a.authors).every((k) => k === k.toUpperCase()),
    Object.keys(a.authors).join("/"));

  // Authors must be REPLACED each round, not accumulated: a stale key would name
  // someone next to a word they never said.
  const before = Object.keys(a.authors).sort().join();
  a = submitWord(a, "p1", "harbour").state;
  a = submitWord(a, "p2", "harbour").state;
  a = submitWord(a, "p3", "harbour").state;
  a = resolveRound(a, ["p1", "p2", "p3"]);
  t("a win records its authors too",
    (a.authors["HARBOUR"] ?? []).length === 3, JSON.stringify(a.authors));
  t("old authors are cleared, not merged",
    Object.keys(a.authors).sort().join() !== before,
    `${before} -> ${Object.keys(a.authors).sort().join()}`);
  t("no author key survives for a word no longer on screen",
    Object.keys(a.authors).every((w) => a.words.includes(w)),
    `${Object.keys(a.authors).join("/")} vs ${a.words.join("/")}`);
}
