/**
 * "Codenames But It's Actually Fun" — pure rules, no DOM, no sockets.
 *
 * From the Discord thread (Alukian): everyone sees the words on screen and
 * privately submits the single word they think bridges them. Match on ALL
 * submissions and the round is won. Miss, and the submitted words BECOME the new
 * prompt — so a failure feeds the next attempt. Win in the fewest tries.
 *
 * N WORDS FOR N PLAYERS, converging on 1. Five players start from five words and
 * each submit the single word bridging them; every distinct answer becomes the
 * next prompt, and everyone saying the same word wins.
 *
 * The word count is NOT a monotonic progress bar. It is bounded above by the
 * player count and can climb again whenever a round produces more distinct
 * answers than the prompt currently holds — a real five-player game might run
 * 5 -> 3 -> 5 -> 4 -> 2 -> 5 -> 1. That thrash is the game: a wide prompt makes
 * the next answer harder to guess, so recovering from it is the interesting part.
 * Don't present the count as "progress".
 *
 * Petisomon's added rule is implemented too: previously used words are barred,
 * which stops the degenerate strategy of everyone repeating one word.
 */

export const MIN_PLAYERS = 2;
export const MAX_WORD_LENGTH = 24;

/**
 * Pool of opening words. A round draws one per player, so the starting prompt is
 * as wide as the group and narrows from there.
 *
 * Deliberately concrete and unrelated to each other: abstract nouns make bad
 * prompts, and words that already suggest a common link make the first round
 * trivial.
 */
export const STARTING_WORDS: string[] = [
  "WARM", "WATER", "NIGHT", "MARKET", "PAPER", "MOON", "SALT", "WOUND",
  "IRON", "HORSE", "GLASS", "CEILING", "SILVER", "TONGUE", "FIRE", "DRILL",
  "GHOST", "TOWN", "SUGAR", "RUSH", "STONE", "COLD", "THUNDER", "STORM",
  "GREEN", "LIGHT", "BROKEN", "RECORD", "OPEN", "BOOK", "HEAVY", "METAL",
  "SHARP", "CORNER", "QUIET", "ENGINE", "BITTER", "ORANGE", "HOLLOW", "CROWN",
];

/** Fewest words a prompt can start with, even in a two-player room. */
export const MIN_PROMPT_WORDS = 2;

/**
 * Draw `count` distinct words for the opening prompt.
 *
 * Uses a partial Fisher-Yates over a copy so no word repeats within one prompt —
 * a duplicate would be banned on sight and make the round unwinnable.
 */
export function drawStartingWords(count: number, rng: () => number = Math.random): string[] {
  const pool = [...STARTING_WORDS];
  const n = Math.max(MIN_PROMPT_WORDS, Math.min(count, pool.length));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * There is deliberately NO "reveal" phase.
 *
 * A missed round used to stop on a reveal screen waiting for the host to press
 * "Next round". The information that screen carried — who said what — now sits
 * above the words themselves, so the pause bought nothing and just added a click
 * between every round.
 */
export type Phase = "lobby" | "submitting" | "won";

export interface CodenamesState {
  phase: Phase;
  /**
   * The words currently on screen. One per player at the start, then one per
   * distinct answer from the previous round — so this shrinks as the group
   * converges, and reaching a single word IS the win.
   */
  words: string[];
  /** userId -> normalised submission for this round. Cleared each round. */
  submissions: Record<string, string>;
  /** Every word already used, so it can't be replayed. Normalised. */
  used: string[];
  round: number;
  /** Set when the round is won — the word everyone agreed on. */
  winningWord: string | null;
  /** Populated when a round resolves, so clients can show who said what. */
  lastReveal: { userId: string; word: string }[] | null;
  /**
   * Who said each word on screen, keyed by the displayed (upper-case) word.
   *
   * A list rather than a single id because duplicate submissions collapse into
   * one word — two players agreeing is exactly how the prompt narrows, and both
   * of them deserve the credit. Empty for the opening prompt, which is drawn
   * from the pool and so has no author.
   */
  authors: Record<string, string[]>;
  /**
   * Cumulative sync points per player: each round you score one point for every
   * OTHER player who said your word. Purely for bragging rights — it does not
   * affect who wins, which is still the whole group converging.
   */
  syncPoints: Record<string, number>;
  /** Points earned in the round just revealed, for a per-round readout. */
  lastRoundSync: Record<string, number> | null;
  /**
   * Games played this session, starting at 1 and never reset.
   *
   * `round` restarts at 1 on a rematch, so it can't identify a win on its own:
   * a client keying a once-only effect (the win confetti) on the round alone
   * would treat the second game's win as one it had already handled.
   */
  gameNumber: number;
  /**
   * How many words were on screen before the current reveal, so the UI can say
   * whether the group narrowed or widened. Comparing against the number of
   * players who answered would be wrong: going 3 -> 4 with five players is a
   * step BACKWARD, but 4 is still fewer than 5.
   */
  prevWordCount: number;
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

/**
 * `playerCount` sets the width of the opening prompt — one word per player.
 * Defaults to 2 so a lobby that hasn't filled yet still has something on screen.
 */
export function createState(
  rng: () => number = Math.random,
  playerCount = MIN_PROMPT_WORDS,
): CodenamesState {
  const words = drawStartingWords(playerCount, rng);
  return {
    phase: "lobby",
    words,
    // The prompt words are banned immediately: submitting a word already on
    // screen isn't a connection, it's a no-op.
    used: words.map(normalizeWord),
    submissions: {},
    round: 1,
    // Nobody said the opening words; they came from the pool.
    authors: {},
    winningWord: null,
    lastReveal: null,
    syncPoints: {},
    lastRoundSync: null,
    prevWordCount: words.length,
    gameNumber: 1,
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
 * Sync points for one round: each player scores the number of OTHER players who
 * submitted the same word.
 *
 * So if three people say HAWAII and two disagree, each of the three scores 2 and
 * the lone answers score 0. A unanimous round therefore pays everyone
 * (players - 1), which is the maximum available.
 */
export function roundSyncPoints(
  submissions: Record<string, string>,
  playerIds: string[],
): Record<string, number> {
  const counts = new Map<string, number>();
  const present = playerIds.filter((id) => id in submissions);
  present.forEach((id) => {
    const w = submissions[id];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  });
  const out: Record<string, number> = {};
  present.forEach((id) => {
    // Minus one so you don't score for your own submission.
    out[id] = (counts.get(submissions[id]) ?? 1) - 1;
  });
  return out;
}

function addSync(
  total: Record<string, number>,
  round: Record<string, number>,
): Record<string, number> {
  const next = { ...total };
  for (const id in round) next[id] = (next[id] ?? 0) + round[id];
  return next;
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
  const roundSync = roundSyncPoints(state.submissions, playerIds);
  const syncPoints = addSync(state.syncPoints, roundSync);

  // Group the authors by the word they landed on, so the board can name them.
  const authors: Record<string, string[]> = {};
  for (const e of entries) {
    const shown = e.word.toUpperCase();
    (authors[shown] ||= []).push(e.userId);
  }

  if (distinct.length === 1) {
    return {
      ...state,
      phase: "won",
      // Collapse the prompt to the agreed word: the goal is literally to get the
      // board down to one word, so leaving the old prompt up hides the payoff.
      words: [distinct[0].toUpperCase()],
      prevWordCount: state.words.length,
      authors,
      winningWord: distinct[0].toUpperCase(),
      lastReveal: reveal,
      used: [...state.used, distinct[0]],
      syncPoints,
      lastRoundSync: roundSync,
    };
  }

  return {
    ...state,
    // Straight back to submitting: no reveal screen, no host click between rounds.
    phase: "submitting",
    words: distinct.map((w) => w.toUpperCase()),
    prevWordCount: state.words.length,
    authors,
    submissions: {},
    used: [...state.used, ...distinct],
    round: state.round + 1,
    winningWord: null,
    lastReveal: reveal,
    syncPoints,
    lastRoundSync: roundSync,
  };
}

/**
 * Most and least in-sync players, for the end-of-game readout. Ties are returned
 * together rather than broken arbitrarily.
 */
export function syncExtremes(syncPoints: Record<string, number>): {
  most: string[];
  least: string[];
  high: number;
  low: number;
} | null {
  const ids = Object.keys(syncPoints);
  if (ids.length === 0) return null;
  const values = ids.map((id) => syncPoints[id]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  return {
    most: ids.filter((id) => syncPoints[id] === high),
    least: ids.filter((id) => syncPoints[id] === low),
    high,
    low,
  };
}

export function startGame(state: CodenamesState): CodenamesState {
  if (state.phase !== "lobby") return state;
  return { ...state, phase: "submitting" };
}

/** Fresh game, keeping nothing — used by the host's "play again". */
export function resetGame(
  rng: () => number = Math.random,
  playerCount = MIN_PROMPT_WORDS,
): CodenamesState {
  return { ...createState(rng, playerCount), phase: "submitting" };
}
