/**
 * Double It Duel room handlers.
 *
 * THE SERVER OWNS THE CLOCK. Elapsed time is measured here from a turn-start
 * timestamp; the client never reports how long it thought. A client that did
 * could claim every answer took zero seconds, which would break the whole
 * economy — nobody would ever lose time and the game could not end.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated from logic.ts. That file is the source of truth and has the tests —
 * change one, change both.
 */

const MIN_NUMBER = 1;
const MAX_NUMBER = 10_000;
const MULTIPLIERS = [2, 3, 4, 5, 6, 7, 8, 9];

const LIMITS = {
  startSeconds: { min: 5, max: 180 },
  // Never zero: the abyss is what guarantees the game ends.
  abyssSeconds: { min: 0.25, max: 10 },
};

const DEFAULT_SETTINGS = { multiplier: 2, startSeconds: 30, abyssSeconds: 1 };
const MAX_TURNS = 500;
/** How often clients get a fresh clock reading while someone is thinking. */
const TICK_MS = 100;

function randomPrompt() {
  return MIN_NUMBER + Math.floor(Math.random() * (MAX_NUMBER - MIN_NUMBER + 1));
}

function clampSettings(partial, base) {
  const out = Object.assign({}, base || DEFAULT_SETTINGS);
  if (!partial || typeof partial !== "object") return out;

  if (typeof partial.multiplier === "number" && MULTIPLIERS.includes(partial.multiplier)) {
    out.multiplier = partial.multiplier;
  }
  if (typeof partial.startSeconds === "number" && Number.isFinite(partial.startSeconds)) {
    const l = LIMITS.startSeconds;
    out.startSeconds = Math.min(l.max, Math.max(l.min, Math.round(partial.startSeconds)));
  }
  if (typeof partial.abyssSeconds === "number" && Number.isFinite(partial.abyssSeconds)) {
    const l = LIMITS.abyssSeconds;
    const snapped = Math.round(partial.abyssSeconds * 4) / 4;
    out.abyssSeconds = Math.min(l.max, Math.max(l.min, snapped));
  }
  return out;
}

function connectedIds(room) {
  return Array.from(room.players.values())
    .filter((p) => p.connected)
    .map((p) => p.id);
}

function freshState(room, settings) {
  const s = clampSettings(settings || {}, DEFAULT_SETTINGS);
  return {
    phase: "lobby",
    settings: s,
    players: connectedIds(room).map((userId) => ({
      userId,
      clock: s.startSeconds,
      alive: true,
      solved: 0,
      eliminatedBy: null,
    })),
    turnIndex: 0,
    prompt: randomPrompt(),
    turns: 0,
    winner: null,
    lastTurn: null,
    wins: {},
    /** Wall-clock ms when the current turn began. Server-side only. */
    turnStartedAt: null,
    /** Interval handle. Never serialised to a client. */
    timer: null,
  };
}

function firstAliveFrom(players, from) {
  for (let i = 0; i < players.length; i++) {
    const idx = (from + i) % players.length;
    if (players[idx] && players[idx].alive) return idx;
  }
  return 0;
}

function nextTurnIndex(players, current) {
  return firstAliveFrom(players, (current + 1) % players.length);
}

function bumpWins(wins, winner) {
  if (!winner) return wins;
  const next = Object.assign({}, wins);
  next[winner] = (next[winner] || 0) + 1;
  return next;
}

/** Seconds the current player has burned so far this turn. */
function elapsedSeconds(state) {
  if (!state.turnStartedAt) return 0;
  return (Date.now() - state.turnStartedAt) / 1000;
}

/** Clock the current player has left right now, accounting for the live turn. */
function liveClock(state, player) {
  const cur = state.players[state.turnIndex];
  if (state.phase !== "playing" || !cur || cur.userId !== player.userId) return player.clock;
  return player.clock - elapsedSeconds(state);
}

function settle(state) {
  const alive = state.players.filter((p) => p.alive);

  if (alive.length === 1) {
    state.phase = "over";
    state.winner = alive[0].userId;
    state.wins = bumpWins(state.wins, state.winner);
    return state;
  }
  if (alive.length === 0) {
    state.phase = "over";
    state.winner = null;
    return state;
  }
  if (state.turns >= MAX_TURNS) {
    const best = Math.max.apply(null, alive.map((p) => p.clock));
    let leaders = alive.filter((p) => p.clock === best);
    if (leaders.length > 1) {
      const bestSolved = Math.max.apply(null, leaders.map((p) => p.solved));
      leaders = leaders.filter((p) => p.solved === bestSolved);
    }
    state.phase = "over";
    state.winner = leaders.length === 1 ? leaders[0].userId : null;
    state.wins = bumpWins(state.wins, state.winner);
    return state;
  }

  const holder = state.players[state.turnIndex];
  if (!holder || !holder.alive) {
    state.turnIndex = nextTurnIndex(state.players, state.turnIndex);
    state.prompt = randomPrompt();
  }
  return state;
}

function beginTurn(state) {
  state.turnStartedAt = Date.now();
}

function stopTimer(state) {
  if (state && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/**
 * Broadcast a live clock while someone thinks, and enforce the timeout.
 *
 * Reads ctx.room.state each tick rather than closing over the state object: a
 * rematch replaces it, and a stale closure would keep ticking the old game.
 */
function startTimer(ctx) {
  const state = ctx.room.state;
  stopTimer(state);
  state.timer = setInterval(() => {
    const live = ctx.room.state;
    if (!live || live.phase !== "playing") {
      stopTimer(live);
      return;
    }
    const cur = live.players[live.turnIndex];
    if (cur && cur.alive && liveClock(live, cur) <= 0) {
      // Out of time: spend the whole clock, eliminate, move on.
      cur.clock = 0;
      cur.alive = false;
      cur.eliminatedBy = "time";
      live.turns += 1;
      live.lastTurn = { userId: cur.userId, took: null, gaveEach: 0, correct: false };
      live.turnIndex = nextTurnIndex(live.players, live.turnIndex);
      live.prompt = randomPrompt();
      settle(live);
      if (live.phase === "over") stopTimer(live);
      else beginTurn(live);
    }
    ctx.broadcast();
  }, TICK_MS);
  if (state.timer.unref) state.timer.unref();
}

module.exports = {
  slug: "double-it-duel",
  minPlayers: 2,

  createState(room) {
    return freshState(room, DEFAULT_SETTINGS);
  },

  publicState(room, state) {
    return {
      phase: state.phase,
      settings: state.settings,
      players: state.players.map((p) => ({
        userId: p.userId,
        // Send the live figure so a watching client sees the clock move without
        // having to run its own copy of the rules.
        clock: Math.max(0, liveClock(state, p)),
        alive: p.alive,
        solved: p.solved,
        eliminatedBy: p.eliminatedBy || null,
      })),
      turnIndex: state.turnIndex,
      currentUserId: state.players[state.turnIndex]
        ? state.players[state.turnIndex].userId
        : null,
      prompt: state.prompt,
      turns: state.turns,
      maxTurns: MAX_TURNS,
      winner: state.winner,
      lastTurn: state.lastTurn,
      wins: state.wins,
      limits: LIMITS,
      multipliers: MULTIPLIERS,
    };
  },

  onEvent(ctx, event, data) {
    const state = ctx.state;

    switch (event) {
      /** Host-only, lobby-only: mirrors how TopTenGame gates its settings. */
      case "settings": {
        if (!ctx.isHost || state.phase !== "lobby") return false;
        state.settings = clampSettings(data, state.settings);
        // Re-seed the clocks so the lobby shows what you'll actually start with.
        state.players.forEach((p) => {
          p.clock = state.settings.startSeconds;
        });
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
        const next = freshState(ctx.room, state.settings);
        next.wins = state.wins;
        next.phase = "playing";
        next.turnIndex = firstAliveFrom(next.players, 0);
        ctx.setState(next);
        beginTurn(ctx.room.state);
        startTimer(ctx);
        return true;
      }

      case "answer": {
        if (state.phase !== "playing") return false;
        const cur = state.players[state.turnIndex];
        // Only the player holding the clock may answer.
        if (!cur || cur.userId !== ctx.userId || !cur.alive) return false;

        const raw = data && data.answer;
        const answer = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(answer)) return false;

        // Measured here, not trusted from the client.
        const took = elapsedSeconds(state);
        cur.clock -= took;

        const correct = answer === state.prompt * state.settings.multiplier;
        const ranOut = cur.clock <= 0;

        if (!correct || ranOut) {
          cur.clock = Math.max(0, cur.clock);
          cur.alive = false;
          cur.eliminatedBy = ranOut ? "time" : "wrong";
          state.turns += 1;
          state.lastTurn = { userId: ctx.userId, took, gaveEach: 0, correct: correct };
          state.turnIndex = nextTurnIndex(state.players, state.turnIndex);
          state.prompt = randomPrompt();
          settle(state);
          if (state.phase === "over") stopTimer(state);
          else beginTurn(state);
          return true;
        }

        // Correct: (took − abyss) split among the other living players. The
        // abyss is simply lost, which is what makes the pool shrink.
        const others = state.players.filter((p) => p.alive && p.userId !== ctx.userId);
        const pot = Math.max(0, took - state.settings.abyssSeconds);
        const gaveEach = others.length > 0 ? pot / others.length : 0;
        // No cap: overflowing past startSeconds is the reward for being fast.
        others.forEach((p) => {
          p.clock += gaveEach;
        });

        cur.solved += 1;
        state.turns += 1;
        state.lastTurn = { userId: ctx.userId, took, gaveEach, correct: true };
        state.turnIndex = nextTurnIndex(state.players, state.turnIndex);
        state.prompt = randomPrompt();
        settle(state);
        if (state.phase === "over") stopTimer(state);
        else beginTurn(state);
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
        const next = freshState(ctx.room, state.settings);
        next.wins = state.wins;
        ctx.setState(next);
        return true;
      }

      default:
        return false;
    }
  },

  /** Leaving forfeits — otherwise everyone waits on a clock nobody is watching. */
  onPlayerLeave(ctx, userId) {
    const state = ctx.state;
    if (!state) return;

    if (state.phase === "lobby") {
      state.players = state.players.filter((p) => p.userId !== userId);
      return;
    }
    if (state.phase !== "playing") return;

    const player = state.players.find((p) => p.userId === userId);
    if (!player || !player.alive) return;

    const wasTheirTurn =
      state.players[state.turnIndex] && state.players[state.turnIndex].userId === userId;

    player.alive = false;
    player.clock = 0;
    player.eliminatedBy = "time";

    if (wasTheirTurn) {
      state.turnIndex = nextTurnIndex(state.players, state.turnIndex);
      state.prompt = randomPrompt();
    }
    settle(state);
    if (state.phase === "over") stopTimer(state);
    else if (wasTheirTurn) beginTurn(state);
  },
};
