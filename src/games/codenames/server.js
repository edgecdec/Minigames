/**
 * Codenames room handlers — the bridge between the room layer and the pure
 * rules in logic.ts.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated here rather than imported from the TypeScript module. Keep the two
 * in sync: logic.ts is the source of truth and has the tests.
 */

/**
 * Pool of opening words. A round draws one per player, so the starting prompt is
 * as wide as the group and narrows from there. Mirrors logic.ts.
 */
const STARTING_WORDS = [
  "WARM", "WATER", "NIGHT", "MARKET", "PAPER", "MOON", "SALT", "WOUND",
  "IRON", "HORSE", "GLASS", "CEILING", "SILVER", "TONGUE", "FIRE", "DRILL",
  "GHOST", "TOWN", "SUGAR", "RUSH", "STONE", "COLD", "THUNDER", "STORM",
  "GREEN", "LIGHT", "BROKEN", "RECORD", "OPEN", "BOOK", "HEAVY", "METAL",
  "SHARP", "CORNER", "QUIET", "ENGINE", "BITTER", "ORANGE", "HOLLOW", "CROWN",
];

const MIN_PROMPT_WORDS = 2;

/** Distinct draw — a repeated prompt word would be banned on sight. */
function drawStartingWords(count) {
  const pool = STARTING_WORDS.slice();
  const n = Math.max(MIN_PROMPT_WORDS, Math.min(count, pool.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

const MAX_WORD_LENGTH = 24;

/**
 * Normalising is what makes "BOIL " and "boil" count as agreement.
 *
 * Casing, whitespace, punctuation and accents only. It deliberately does NOT
 * stem: an earlier version collapsed -ing/-ies/-es/-s, which was wrong in both
 * directions. It merged words players consider distinct ("string" -> "str",
 * "spring" -> "spr", "bring" -> "br"), and because unrelated words can stem
 * alike it also declared agreement nobody had actually reached. The -es rule
 * alone had to be fixed twice — plain /ses$/ turned "horses" into "hors", so it
 * stopped matching its own singular.
 *
 * A crude stemmer guessing at English morphology is worse than no stemmer: two
 * players only match on the word they actually typed. The NFKD pass stays, since
 * that is what stops homoglyph and zero-width tricks.
 */
function normalizeWord(raw) {
  return String(raw)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * `playerCount` sets the width of the opening prompt — one word per player, then
 * one word per distinct answer, so the count shrinks as the group converges and
 * reaching a single word is the win.
 */
function freshState(playerCount) {
  const words = drawStartingWords(playerCount || MIN_PROMPT_WORDS);
  return {
    phase: "lobby",
    words,
    submissions: {},
    // Prompt words are banned immediately: repeating one isn't a connection.
    used: words.map(normalizeWord),
    round: 1,
    // Nobody said the opening words; they came from the pool.
    authors: {},
    winningWord: null,
    lastReveal: null,
    // Cumulative "sync points": each round you score one point per OTHER player
    // who said your word. Bragging rights only — winning is still the group
    // converging on a single word. Mirrors logic.ts.
    syncPoints: {},
    lastRoundSync: null,
    prevWordCount: words.length,
    // Never reset: `round` restarts on a rematch, so a client can't use it alone
    // to tell one game's win from the next. Mirrors logic.ts.
    gameNumber: 1,
  };
}

/** Each player scores the number of OTHER players who submitted the same word. */
function roundSyncPoints(submissions, playerIds) {
  const counts = new Map();
  const present = playerIds.filter((id) => id in submissions);
  present.forEach((id) => {
    const w = submissions[id];
    counts.set(w, (counts.get(w) || 0) + 1);
  });
  const out = {};
  // Minus one so you don't score for your own submission.
  present.forEach((id) => {
    out[id] = (counts.get(submissions[id]) || 1) - 1;
  });
  return out;
}

function connectedIds(room) {
  return Array.from(room.players.values())
    .filter((p) => p.connected)
    .map((p) => p.id);
}

function resolve(room, state) {
  const ids = connectedIds(room);
  const entries = ids
    .filter((id) => id in state.submissions)
    .map((id) => ({ userId: id, word: state.submissions[id] }));
  if (entries.length === 0) return state;

  const distinct = Array.from(new Set(entries.map((e) => e.word)));
  const reveal = entries.map((e) => ({ userId: e.userId, word: e.word.toUpperCase() }));
  const roundSync = roundSyncPoints(state.submissions, ids);
  const syncPoints = Object.assign({}, state.syncPoints);
  for (const id in roundSync) syncPoints[id] = (syncPoints[id] || 0) + roundSync[id];

  // Who said each surviving word. A list, because duplicate submissions collapse
  // into one word and both authors earned it.
  const authors = {};
  for (const e of entries) {
    const shown = e.word.toUpperCase();
    if (!authors[shown]) authors[shown] = [];
    authors[shown].push(e.userId);
  }

  if (distinct.length === 1) {
    return {
      ...state,
      phase: "won",
      // Collapse the prompt to the agreed word — getting the board down to one
      // word IS the goal, so leaving the old prompt up hides the payoff.
      words: [distinct[0].toUpperCase()],
      prevWordCount: state.words.length,
      authors,
      winningWord: distinct[0].toUpperCase(),
      lastReveal: reveal,
      used: state.used.concat(distinct),
      syncPoints,
      lastRoundSync: roundSync,
    };
  }

  // EVERY distinct word carries forward. Truncating to two would discard the
  // other players' answers, so the group would converge on a prompt most of
  // them never saw. Duplicates collapsing is the mechanism of progress.
  return {
    ...state,
    // Straight back into submitting. There is no reveal phase: authorship now
    // shows above each word, so a pause between rounds bought nothing but a click.
    phase: "submitting",
    words: distinct.map((w) => w.toUpperCase()),
    prevWordCount: state.words.length,
    authors,
    submissions: {},
    used: state.used.concat(distinct),
    round: state.round + 1,
    winningWord: null,
    lastReveal: reveal,
    syncPoints,
    lastRoundSync: roundSync,
  };
}

module.exports = {
  slug: "codenames",
  minPlayers: 2,

  createState(room) {
    return freshState(connectedIds(room).length);
  },

  /**
   * Submissions are hidden until the round resolves — seeing someone else's word
   * first would let you simply copy it, which is the entire game.
   */
  publicState(room, state) {
    return {
      phase: state.phase,
      words: state.words,
      round: state.round,
      winningWord: state.winningWord,
      lastReveal: state.lastReveal,
      /** Who said each word on screen. Empty for the opening prompt. */
      authors: state.authors || {},
      usedCount: state.used.length,
      syncPoints: state.syncPoints,
      lastRoundSync: state.lastRoundSync,
      prevWordCount: state.prevWordCount,
      gameNumber: state.gameNumber,
      /** Ceiling on the prompt: it can never exceed the number of players. */
      playerCount: connectedIds(room).length,
      // Who has locked in, not what they said.
      submitted: Object.keys(state.submissions),
      waitingOn: connectedIds(room).filter((id) => !(id in state.submissions)).length,
    };
  },

  onEvent(ctx, event, data) {
    const { room } = ctx;
    let state = ctx.state;

    switch (event) {
      case "start": {
        if (!ctx.isHost) return false;
        if (state.phase !== "lobby") return false;
        const playerCount = connectedIds(room).length;
        if (playerCount < module.exports.minPlayers) {
          ctx.emitToPlayer("room_error", { message: "Need at least 2 players" });
          return false;
        }
        // Redraw at the real headcount. createState ran when the host was alone,
        // so reusing it would open a 4-player game on a 2-word prompt.
        ctx.setState({ ...freshState(playerCount), phase: "submitting" });
        return true;
      }

      case "submit": {
        if (state.phase !== "submitting") return false;
        const raw = data && data.word;
        if (typeof raw !== "string" || raw.trim() === "") {
          ctx.emitToPlayer("room_error", { message: "Type a word" });
          return false;
        }
        if (raw.length > MAX_WORD_LENGTH) {
          ctx.emitToPlayer("room_error", { message: "Too long" });
          return false;
        }
        const norm = normalizeWord(raw);
        if (!norm) {
          ctx.emitToPlayer("room_error", { message: "Letters only" });
          return false;
        }
        if (state.used.includes(norm)) {
          ctx.emitToPlayer("room_error", { message: "Already used — try another" });
          return false;
        }

        state = { ...state, submissions: { ...state.submissions, [ctx.userId]: norm } };
        ctx.setState(state);

        // Resolve as soon as every connected player has answered.
        const ids = connectedIds(room);
        if (ids.length > 0 && ids.every((id) => id in state.submissions)) {
          ctx.setState(resolve(room, state));
        }
        return true;
      }

      case "again": {
        if (!ctx.isHost) return false;
        // Carry the tally across games: it's a session-long "who thinks alike".
        ctx.setState({
          ...freshState(connectedIds(room).length),
          phase: "submitting",
          syncPoints: state.syncPoints,
          gameNumber: (state.gameNumber || 1) + 1,
        });
        return true;
      }

      default:
        return false;
    }
  },

  /**
   * A player leaving mid-round must not deadlock everyone else waiting on a word
   * that will never arrive.
   */
  onPlayerLeave(ctx, userId) {
    const state = ctx.state;
    if (!state || state.phase !== "submitting") return;
    if (state.submissions[userId]) {
      const next = { ...state.submissions };
      delete next[userId];
      ctx.setState({ ...state, submissions: next });
    }
    const ids = connectedIds(ctx.room);
    const remaining = ids.filter((id) => id !== userId);
    if (remaining.length > 0 && remaining.every((id) => id in ctx.state.submissions)) {
      ctx.setState(resolve(ctx.room, ctx.state));
    }
  },
};
