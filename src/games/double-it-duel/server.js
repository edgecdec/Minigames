/**
 * Multiplayer Double It! room handlers — the passing clock.
 *
 * Server-authoritative: the server owns the clock, deals every prompt, and
 * decides who ran out. A client that timed its own turn could simply claim it
 * answered instantly, which is the entire currency of this game.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated from logic.ts. That file is the source of truth and has the tests —
 * change one, change both.
 */

const MULTIPLIERS = [2, 3, 4, 5, 6, 7, 8, 9];
const START_SECONDS_OPTIONS = [10, 20, 30, 45, 60, 90, 120];
const ABYSS_SECONDS_OPTIONS = [0.5, 1, 2, 3, 5];
const MIN_NUMBER = 1;
const MAX_NUMBER = 10000;
/** How often the clock is broadcast while a turn runs. */
const TICK_MS = 200;

const DEFAULT_SETTINGS = { multiplier: 2, startSeconds: 30, abyssSeconds: 1 };

function cleanSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    multiplier: MULTIPLIERS.includes(s.multiplier) ? s.multiplier : DEFAULT_SETTINGS.multiplier,
    startSeconds: START_SECONDS_OPTIONS.includes(s.startSeconds)
      ? s.startSeconds
      : DEFAULT_SETTINGS.startSeconds,
    abyssSeconds: ABYSS_SECONDS_OPTIONS.includes(s.abyssSeconds)
      ? s.abyssSeconds
      : DEFAULT_SETTINGS.abyssSeconds,
  };
}

function randomPrompt() {
  return MIN_NUMBER + Math.floor(Math.random() * (MAX_NUMBER - MIN_NUMBER + 1));
}

function connectedIds(room) {
  return Array.from(room.players.values())
    .filter((p) => p.connected)
    .map((p) => p.id);
}

function freshState(settings) {
  return {
    phase: "lobby",
    settings: settings || Object.assign({}, DEFAULT_SETTINGS),
    players: [],
    turnIndex: 0,
    prompt: randomPrompt(),
    turnStartedAt: 0,
    winner: null,
    lastEvent: null,
    round: 1,
    /** Interval handle. Never serialised to a client. */
    timer: null,
  };
}

function startDuel(state, userIds) {
  const s = state.settings;
  return Object.assign({}, state, {
    phase: "playing",
    players: userIds.map((userId) => ({
      userId,
      ms: s.startSeconds * 1000,
      alive: true,
      solved: 0,
      place: null,
    })),
    turnIndex: 0,
    prompt: randomPrompt(),
    turnStartedAt: Date.now(),
    winner: null,
    lastEvent: null,
    round: 1,
  });
}

function target(state) {
  return state.prompt * state.settings.multiplier;
}

function nextAliveIndex(state, from) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (state.players[idx].alive) return idx;
  }
  return from;
}

/** Mutates in place: eliminate, assign a place, and end the game if one remains. */
function eliminate(state, index) {
  const p = state.players[index];
  if (!p || !p.alive) return;
  p.alive = false;
  p.ms = 0;
  const aliveCount = state.players.filter((x) => x.alive).length;
  p.place = aliveCount + 1;
  if (aliveCount <= 1) {
    const survivor = state.players.find((x) => x.alive);
    if (survivor) survivor.place = 1;
    state.phase = "over";
    state.winner = survivor ? survivor.userId : null;
  }
}

/** spent comes off the answerer; spent - abyss splits among the living others. */
function settleClock(state, spentMs) {
  const abyssMs = state.settings.abyssSeconds * 1000;
  const active = state.players[state.turnIndex];
  const others = state.players.filter((p) => p.alive && p.userId !== active.userId);
  const share = others.length > 0 ? (spentMs - abyssMs) / others.length : 0;
  active.ms -= spentMs;
  others.forEach((p) => {
    // Overflow above the starting clock is intentional; the floor stops a fast
    // answer pushing someone negative before reapEmpty sees them.
    p.ms = Math.max(0, p.ms + share);
  });
}

function reapEmpty(state) {
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.alive && p.ms <= 0) {
      eliminate(state, i);
      if (state.phase === "over") return;
    }
  }
}

function advance(state, newPrompt) {
  if (state.phase === "over") return;
  state.turnIndex = nextAliveIndex(state, state.turnIndex);
  if (newPrompt) state.prompt = randomPrompt();
  state.turnStartedAt = Date.now();
  state.round += 1;
}

function stopTimer(state) {
  if (state && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/**
 * Broadcast the clock while a turn runs, and enforce a timeout when the active
 * player simply stops playing — nobody else will submit anything on their behalf.
 */
function startTimer(ctx) {
  const state = ctx.room.state;
  stopTimer(state);
  state.timer = setInterval(() => {
    // Re-read: a rematch replaces the state object and a stale closure would
    // keep driving the previous duel.
    const live = ctx.room.state;
    if (!live || live.phase !== "playing") {
      stopTimer(live);
      return;
    }
    const active = live.players[live.turnIndex];
    if (active && active.alive && Date.now() - live.turnStartedAt >= active.ms) {
      live.lastEvent = {
        userId: active.userId,
        kind: "timeout",
        prompt: live.prompt,
        spentMs: active.ms,
        sharedMs: 0,
      };
      eliminate(live, live.turnIndex);
      advance(live, true);
      if (live.phase === "over") stopTimer(live);
    }
    ctx.broadcast();
  }, TICK_MS);
  if (state.timer.unref) state.timer.unref();
}

module.exports = {
  slug: "double-it-duel",
  minPlayers: 2,

  createState() {
    return freshState();
  },

  /** The timer handle must never reach a client. */
  publicState(room, state) {
    const now = Date.now();
    const active = state.players[state.turnIndex];
    // In the lobby there are no seated players yet, but the clock rows are the
    // clearest way to show what a setting means — so preview everyone in the room
    // at the configured starting time.
    const seats =
      state.phase === "lobby"
        ? connectedIds(room).map((userId) => ({
            userId,
            ms: state.settings.startSeconds * 1000,
            alive: true,
            solved: 0,
            place: null,
          }))
        : null;
    return {
      phase: state.phase,
      settings: state.settings,
      players: (seats || state.players).map((p) => ({
        userId: p.userId,
        // Send the LIVE clock so a client needs no local timing model: only the
        // player on turn is burning time.
        ms: Math.max(
          0,
          state.phase === "playing" && p.alive && active && p.userId === active.userId
            ? p.ms - (now - state.turnStartedAt)
            : p.ms,
        ),
        alive: p.alive,
        solved: p.solved,
        place: p.place,
      })),
      turnUserId: active ? active.userId : null,
      prompt: state.prompt,
      round: state.round,
      winner: state.winner,
      lastEvent: state.lastEvent,
      // Options travel with the state so the lobby UI can't drift from the
      // server's idea of what's allowed.
      options: {
        multipliers: MULTIPLIERS,
        startSeconds: START_SECONDS_OPTIONS,
        abyssSeconds: ABYSS_SECONDS_OPTIONS,
      },
    };
  },

  onEvent(ctx, event, data) {
    const state = ctx.state;

    switch (event) {
      case "settings": {
        if (!ctx.isHost) return false;
        // Locked once play starts: changing the multiplier mid-duel would
        // silently move the goalposts for whoever is on turn.
        if (state.phase === "playing") {
          ctx.emitToPlayer("room_error", { message: "Can't change settings mid-game" });
          return false;
        }
        state.settings = cleanSettings(Object.assign({}, state.settings, data || {}));
        return true;
      }

      case "start": {
        if (!ctx.isHost) return false;
        if (state.phase === "playing") return false;
        const ids = connectedIds(ctx.room);
        if (ids.length < module.exports.minPlayers) {
          ctx.emitToPlayer("room_error", { message: "Needs at least 2 players" });
          return false;
        }
        stopTimer(state);
        ctx.setState(startDuel(state, ids));
        startTimer(ctx);
        return true;
      }

      case "answer": {
        if (state.phase !== "playing") return false;
        const active = state.players[state.turnIndex];
        if (!active || active.userId !== ctx.userId || !active.alive) return false;

        const value = Number(data && data.value);
        if (!Number.isFinite(value)) return false;

        const now = Date.now();
        const spentMs = Math.max(0, now - state.turnStartedAt);

        // Clock ran out mid-thought: no transfer, just elimination.
        if (spentMs >= active.ms) {
          state.lastEvent = {
            userId: ctx.userId,
            kind: "timeout",
            prompt: state.prompt,
            spentMs: active.ms,
            sharedMs: 0,
          };
          eliminate(state, state.turnIndex);
          advance(state, true);
          if (state.phase === "over") stopTimer(state);
          return true;
        }

        const correct = value === target(state);
        const abyssMs = state.settings.abyssSeconds * 1000;
        const others = state.players.filter(
          (p) => p.alive && p.userId !== active.userId,
        ).length;

        settleClock(state, spentMs);
        if (correct) active.solved += 1;
        state.lastEvent = {
          userId: ctx.userId,
          kind: correct ? "correct" : "wrong",
          prompt: state.prompt,
          answer: value,
          spentMs,
          sharedMs: others > 0 ? (spentMs - abyssMs) / others : 0,
        };

        reapEmpty(state);
        if (state.phase === "over") {
          stopTimer(state);
          return true;
        }
        // A wrong answer passes the SAME number on, so the next player inherits
        // a prompt someone already failed.
        advance(state, correct);
        return true;
      }

      case "again": {
        if (!ctx.isHost || state.phase !== "over") return false;
        const ids = connectedIds(ctx.room);
        if (ids.length < module.exports.minPlayers) {
          ctx.emitToPlayer("room_error", { message: "Need 2 players for a rematch" });
          return false;
        }
        stopTimer(state);
        ctx.setState(startDuel(state, ids));
        startTimer(ctx);
        return true;
      }

      default:
        return false;
    }
  },

  /** A player leaving must not stall the table on a turn nobody can take. */
  onPlayerLeave(ctx, userId) {
    const state = ctx.state;
    if (!state || state.phase !== "playing") return;
    const idx = state.players.findIndex((p) => p.userId === userId);
    if (idx < 0 || !state.players[idx].alive) return;

    const wasTheirTurn = state.turnIndex === idx;
    eliminate(state, idx);
    if (state.phase === "over") {
      stopTimer(state);
      return;
    }
    if (wasTheirTurn) advance(state, true);
  },
};
