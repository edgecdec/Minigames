/**
 * Codenames room handlers — the bridge between the room layer and the pure
 * rules in logic.ts.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated here rather than imported from the TypeScript module. Keep the two
 * in sync: logic.ts is the source of truth and has the tests.
 */

const STARTING_PAIRS = [
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

const MAX_WORD_LENGTH = 24;

function normalizeWord(raw) {
  let w = String(raw)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (w.length > 4) {
    if (w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.endsWith("ies")) w = w.slice(0, -3) + "y";
    // Only strip a full "-es" after a sibilant, where it's a real syllable
    // (dishes -> dish). Stripping every "-es" turns horses into "hors" and
    // kettles into "kettl", so they stop matching their own singular.
    // Mirrors logic.ts — keep the two identical.
    else if (/(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  }
  return w;
}

function freshState() {
  const pair = STARTING_PAIRS[Math.floor(Math.random() * STARTING_PAIRS.length)];
  return {
    phase: "lobby",
    // N words for N players: a round starts from a pair, then carries one word
    // per distinct answer, so the count shrinks as the group converges.
    words: [pair[0], pair[1]],
    submissions: {},
    used: [normalizeWord(pair[0]), normalizeWord(pair[1])],
    round: 1,
    winningWord: null,
    lastReveal: null,
  };
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

  if (distinct.length === 1) {
    return {
      ...state,
      phase: "won",
      winningWord: distinct[0].toUpperCase(),
      lastReveal: reveal,
      used: state.used.concat(distinct),
    };
  }

  // EVERY distinct word carries forward. Truncating to two would discard the
  // other players' answers, so the group would converge on a prompt most of
  // them never saw. Duplicates collapsing is the mechanism of progress.
  return {
    ...state,
    phase: "reveal",
    words: distinct.map((w) => w.toUpperCase()),
    submissions: {},
    used: state.used.concat(distinct),
    round: state.round + 1,
    winningWord: null,
    lastReveal: reveal,
  };
}

module.exports = {
  slug: "codenames",
  minPlayers: 2,

  createState() {
    return freshState();
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
      usedCount: state.used.length,
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
        if (connectedIds(room).length < module.exports.minPlayers) {
          ctx.emitToPlayer("room_error", { message: "Need at least 2 players" });
          return false;
        }
        ctx.setState({ ...state, phase: "submitting" });
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

      case "continue": {
        if (!ctx.isHost || state.phase !== "reveal") return false;
        ctx.setState({ ...state, phase: "submitting" });
        return true;
      }

      case "again": {
        if (!ctx.isHost) return false;
        ctx.setState({ ...freshState(), phase: "submitting" });
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
