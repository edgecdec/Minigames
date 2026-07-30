import {
  createState,
  normalizeWord,
  submitWord,
  everyoneSubmitted,
  resolveRound,
  continueRound,
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
t("gerund collapses", normalizeWord("boiling") === normalizeWord("boil"));
t("plural collapses", normalizeWord("showers") === normalizeWord("shower"));
t("-ies plural", normalizeWord("berries") === normalizeWord("berry"));
t("-es plural after sibilant", normalizeWord("dishes") === normalizeWord("dish"));
// Regression: an unconditional "-es" strip turned these into "kettl"/"hors",
// so a player typing the plural never matched someone typing the singular.
t("kettles matches kettle", normalizeWord("kettles") === normalizeWord("kettle"), normalizeWord("kettles"));
t("horses matches horse", normalizeWord("horses") === normalizeWord("horse"), normalizeWord("horses"));
t("candles matches candle", normalizeWord("candles") === normalizeWord("candle"));
t("boxes matches box", normalizeWord("boxes") === normalizeWord("box"));
t("churches matches church", normalizeWord("churches") === normalizeWord("church"));
t("glasses matches glass", normalizeWord("glasses") === normalizeWord("glass"));
t("accents folded", normalizeWord("café") === "cafe");
t("short words untouched", normalizeWord("gas") === "gas");
t("double-s kept", normalizeWord("glass") === "glass", normalizeWord("glass"));
t("digits dropped", normalizeWord("b0il") === "bil");
t("empty on symbols only", normalizeWord("!!!") === "");

// --- setup ---
let s = createState(seeded);
t("starts in lobby", s.phase === "lobby");
t("has a pair", s.pair.length === 2 && s.pair[0] !== s.pair[1]);
t("pair words pre-banned", s.used.length === 2);
t("round starts at 1", s.round === 1);

s = startGame(s);
t("start moves to submitting", s.phase === "submitting");

// --- submission validation ---
t("rejects empty", submitWord(s, "u1", "   ").error !== undefined);
t("rejects symbols only", submitWord(s, "u1", "###").error !== undefined);
t("rejects overlong", submitWord(s, "u1", "x".repeat(MAX_WORD_LENGTH + 1)).error !== undefined);
t("rejects a banned pair word", submitWord(s, "u1", s.pair[0]).error !== undefined);
t("accepts a fresh word", submitWord(s, "u1", "kettle").error === undefined);

// submissions are stored normalised
s = submitWord(s, "u1", "Boiling").state;
t("stored normalised", s.submissions["u1"] === "boil", s.submissions["u1"]);

// --- waiting logic ---
t("not everyone in yet", !everyoneSubmitted(s, ["u1", "u2"]));
s = submitWord(s, "u2", "shower").state;
t("everyone submitted", everyoneSubmitted(s, ["u1", "u2"]));

// --- mismatch feeds the next round ---
let next = resolveRound(s, ["u1", "u2"]);
t("mismatch -> reveal", next.phase === "reveal");
t("submitted words become the pair", next.pair.includes("BOIL") && next.pair.includes("SHOWER"), next.pair.join("/"));
t("round advanced", next.round === 2);
t("submissions cleared", Object.keys(next.submissions).length === 0);
t("reveal shows who said what", (next.lastReveal ?? []).length === 2);
t("both words now banned", next.used.includes("boil") && next.used.includes("shower"));

next = continueRound(next);
t("continue -> submitting", next.phase === "submitting");

// used words can't be replayed — Petisomon's rule
t("cannot reuse a previous word", submitWord(next, "u1", "boiling").error !== undefined);
t("cannot reuse across rounds either", submitWord(next, "u2", "showers").error !== undefined);

// --- agreement wins ---
let win = submitWord(next, "u1", "steam").state;
win = submitWord(win, "u2", "STEAMING").state; // normalises to the same word
t("different spellings agree", win.submissions["u1"] === win.submissions["u2"]);
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
t("3-way mismatch still yields 2 words", r3.pair.length === 2);
t("all three words banned", ["alpha", "bravo", "charlie"].every((w) => r3.used.includes(w)));
let allAgree = startGame(createState(seeded));
allAgree = submitWord(allAgree, "a", "delta").state;
allAgree = submitWord(allAgree, "b", "delta").state;
allAgree = submitWord(allAgree, "c", "Deltas").state;
t("unanimous with 3 wins", resolveRound(allAgree, ["a", "b", "c"]).phase === "won");

// --- guards ---
t("submit outside submitting phase rejected", submitWord(createState(seeded), "u1", "x").error !== undefined);
t("resolve with no submissions is a no-op", resolveRound(startGame(createState(seeded)), ["u1"]).phase === "submitting");
t("continue outside reveal is a no-op", continueRound(win).phase === "won");

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
