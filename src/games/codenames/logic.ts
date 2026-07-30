/**
 * "Codenames But It's Actually Fun" — pure rules, no DOM, no sockets.
 *
 * From the Discord thread (Alukian): everyone sees the words on screen and
 * privately submits the single word they think bridges them. Match on ALL
 * submissions and the round is won. Miss, and the submitted words BECOME the new
 * prompt — so a failure feeds the next attempt. Win in the fewest tries.
 *
 * N words for N players. With 4 players a miss leaves 4 words, and the group
 * converges as players start agreeing: 4 distinct answers -> 3 -> 2 -> 1 = win.
 * The word count on screen is therefore a live progress bar for how close the
 * group is, which is the whole appeal.
 *
 * Petisomon's added rule is implemented too: previously used words are barred,
 * which stops the degenerate strategy of everyone repeating one word.
 */

export const MIN_PLAYERS = 2;
export const MAX_WORD_LENGTH = 24;

/**
 * Opening prompts, always two words regardless of player count — a round starts
 * from a pair and then widens or narrows with the group. Deliberately concrete;
 * abstract nouns make bad prompts.
 */
export const STARTING_PAIRS: [string, string][] = [
  ["WARM", "WATER"],
  ["NIGHT", "MARKET"],
  ["PAPER", "MOON"],
  ["SALT", "WOUND"],
  ["IRON", "HORSE"],
  ["GLASS", "CEILING"],
  ["SILVER", "TONGUE"],
  ["FIRE", "DRILL"],
  ["GHOST", "TOWN"],
  ["SUGAR", "RUSH"],
  ["STONE", "COLD"],
  ["THUNDER", "STORM"],
  ["GREEN", "LIGHT"],
  ["BROKEN", "RECORD"],
  ["OPEN", "BOOK"],
  ["HEAVY", "METAL"],
];

export type Phase = "lobby" | "submitting" | "reveal" | "won";

export interface CodenamesState {
  phase: Phase;
  /**
   * The words currently on screen. Two at the start, then one per distinct
   * answer from the previous round — so this shrinks as the group converges.
   */
  words: string[];
  /** userId -> normalised submission for this round. Cleared each round. */
  submissions: Record<string, string>;
  /** Every word already used, so it can't be replayed. Normalised. */
  used: string[];
  round: number;
  /** Set when the round is won — the word everyone agreed on. */
  winningWord: string | null;
  /** Populated at reveal so clients can show who said what. */
  lastReveal: { userId: string; word: string }[] | null;
}

/**
 * Normalising is what makes "boiling", "BOIL " and "boil" count as agreement.
 * Deliberately conservative: casing, whitespace, punctuation, and a couple of
 * plural/gerund endings. It does NOT stem aggressively — turning "running" into
 * "run" would also collapse words players consider distinct.
 */
export function normalizeWord(raw: string): string {
  let w = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (w.length > 4) {
    if (w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.endsWith("ies")) w = w.slice(0, -3) + "y";
    // Strip a full "-es" only after a real sibilant cluster, where it forms its
    // own syllable (dishes -> dish, boxes -> box). Note "ss" and not a bare "s":
    // matching plain /ses$/ turns horses into "hors" and kettles into "kettl",
    // so neither matches its own singular. That was a real bug; the two-client
    // test caught it after the unit tests missed it.
    else if (/(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  }
  return w;
}

export function createState(rng: () => number = Math.random): CodenamesState {
  const pair = STARTING_PAIRS[Math.floor(rng() * STARTING_PAIRS.length)];
  return {
    phase: "lobby",
    words: [pair[0], pair[1]],
    submissions: {},
    used: [normalizeWord(pair[0]), normalizeWord(pair[1])],
    round: 1,
    winningWord: null,
    lastReveal: null,
  };
}

export interface SubmitResult {
  state: CodenamesState;
  error?: string;
}

/** Validate and record one player's word. Does not resolve the round. */
export function submitWord(
  state: CodenamesState,
  userId: string,
  raw: string,
): SubmitResult {
  if (state.phase !== "submitting") {
    return { state, error: "Not accepting words right now" };
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return { state, error: "Type a word" };
  }
  if (raw.length > MAX_WORD_LENGTH) {
    return { state, error: `Keep it under ${MAX_WORD_LENGTH} characters` };
  }

  const norm = normalizeWord(raw);
  if (!norm) return { state, error: "Letters only" };
  if (state.used.includes(norm)) {
    return { state, error: "That word has already been used" };
  }

  return {
    state: {
      ...state,
      submissions: { ...state.submissions, [userId]: norm },
    },
  };
}

/** True once every connected player has submitted. */
export function everyoneSubmitted(
  state: CodenamesState,
  playerIds: string[],
): boolean {
  return playerIds.length > 0 && playerIds.every((id) => id in state.submissions);
}

/**
 * Resolve a round. Unanimous agreement wins; otherwise EVERY distinct submitted
 * word becomes the next prompt.
 *
 * Keeping all of them is what makes this scale past two players: truncating to
 * the first two would silently discard the other answers, so the group would be
 * converging on a prompt most of them never saw.
 *
 * Duplicates collapse, which is the mechanism of progress — when two of four
 * players agree, the next round starts from three words instead of four.
 */
export function resolveRound(
  state: CodenamesState,
  playerIds: string[],
  displayFor: (userId: string, norm: string) => string = (_u, n) => n.toUpperCase(),
): CodenamesState {
  const entries = playerIds
    .filter((id) => id in state.submissions)
    .map((id) => ({ userId: id, word: state.submissions[id] }));

  if (entries.length === 0) return state;

  const distinct = Array.from(new Set(entries.map((e) => e.word)));
  const reveal = entries.map((e) => ({
    userId: e.userId,
    word: displayFor(e.userId, e.word),
  }));

  if (distinct.length === 1) {
    return {
      ...state,
      phase: "won",
      winningWord: distinct[0].toUpperCase(),
      lastReveal: reveal,
      used: [...state.used, distinct[0]],
    };
  }

  return {
    ...state,
    phase: "reveal",
    words: distinct.map((w) => w.toUpperCase()),
    submissions: {},
    used: [...state.used, ...distinct],
    round: state.round + 1,
    winningWord: null,
    lastReveal: reveal,
  };
}

/** Move from reveal into the next submitting phase. */
export function continueRound(state: CodenamesState): CodenamesState {
  if (state.phase !== "reveal") return state;
  return { ...state, phase: "submitting", lastReveal: state.lastReveal };
}

export function startGame(state: CodenamesState): CodenamesState {
  if (state.phase !== "lobby") return state;
  return { ...state, phase: "submitting" };
}

/** Fresh game, keeping nothing — used by the host's "play again". */
export function resetGame(rng: () => number = Math.random): CodenamesState {
  return { ...createState(rng), phase: "submitting" };
}
