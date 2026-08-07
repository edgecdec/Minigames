/**
 * Snake free-for-all room handlers.
 *
 * Server-authoritative and the first game here with a real tick loop: the
 * server advances the board on a timer and broadcasts, while clients only send a
 * desired direction. A client that ran its own simulation could simply announce
 * that it won.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated from logic.ts. That file is the source of truth and has the tests —
 * change one, change both.
 */

const COLS = 24;
const ROWS = 24;
const TICK_MS = 160;
/** Wall-clock length of each countdown number, so 3-2-1 takes ~3 real seconds. */
const COUNTDOWN_STEP_MS = 1000;
const FOOD_COUNT = 3;
const MAX_TICKS = 3000;
const MAX_PLAYERS = 8;
/**
 * Spawn protection: snake-vs-snake collisions are off for this long. Random
 * spawns can land two players near each other, and dying in the first second to
 * someone you never saw is the worst possible start. Walls and your own body
 * still kill, so the window isn't consequence-free.
 */
const SPAWN_PROTECT_TICKS = Math.round(3000 / TICK_MS);
const SPAWN_MARGIN = 4;
const MIN_SPAWN_GAP = 6;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Random spawns, kept apart so protection isn't just postponing a crash. */
function pickSpawns(count) {
  const chosen = [];
  const span = COLS - SPAWN_MARGIN * 2;
  for (let i = 0; i < count; i++) {
    let best = null;
    // Relax the spacing if the board is too crowded to honour it, so this
    // terminates instead of spinning.
    for (let gap = MIN_SPAWN_GAP; gap >= 0 && !best; gap--) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const at = {
          x: SPAWN_MARGIN + Math.floor(Math.random() * span),
          y: SPAWN_MARGIN + Math.floor(Math.random() * span),
        };
        if (chosen.every((c) => Math.abs(c.at.x - at.x) + Math.abs(c.at.y - at.y) >= gap)) {
          best = at;
          break;
        }
      }
    }
    const at = best || {
      x: SPAWN_MARGIN + Math.floor(Math.random() * span),
      y: SPAWN_MARGIN + Math.floor(Math.random() * span),
    };
    chosen.push({ at, dir: facingOpenBoard(at) });
  }
  return chosen;
}

/**
 * Face whichever direction has the most room ahead. A random facing kills people
 * during spawn protection — walls still kill then, and a snake dropped near an
 * edge pointing at it crashes before the player has reason to be watching.
 * Mirrors logic.ts.
 */
function facingOpenBoard(at) {
  const runway = [
    { dir: DIRS.right, room: COLS - 1 - at.x },
    { dir: DIRS.left, room: at.x },
    { dir: DIRS.down, room: ROWS - 1 - at.y },
    { dir: DIRS.up, room: at.y },
  ];
  runway.sort((a, b) => b.room - a.room);
  return runway[0].dir;
}

function samePos(a, b) {
  return a.x === b.x && a.y === b.y;
}

function spawnSnake(userId, spawn) {
  const body = [0, 1, 2].map((i) => ({
    x: spawn.at.x - spawn.dir.x * i,
    y: spawn.at.y - spawn.dir.y * i,
  }));
  return {
    userId,
    body,
    dir: spawn.dir,
    queued: [],
    alive: true,
    score: 0,
    causeOfDeath: null,
  };
}

function occupied(state) {
  return state.snakes.reduce((acc, s) => acc.concat(s.body), []);
}

function placeFood(taken, count) {
  const free = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!taken.some((c) => c.x === x && c.y === y)) free.push({ x, y });
    }
  }
  const out = [];
  for (let i = 0; i < count && free.length > 0; i++) {
    out.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
  }
  return out;
}

function createDuel(userIds, wins, phase) {
  const ids = userIds.slice(0, MAX_PLAYERS);
  const spawns = pickSpawns(ids.length);
  const snakes = ids.map((id, i) => spawnSnake(id, spawns[i]));
  const state = {
    // Always "waiting" unless the caller asks for a phase. A duel must be
    // started deliberately: deriving the phase from the player count made a
    // fresh board look already-live, so the host's "start" was rejected as a
    // duplicate and the tick loop never began.
    phase: phase || "waiting",
    snakes,
    food: [],
    tick: 0,
    winner: null,
    countdown: 3,
    /** Set when the countdown begins; the remaining number is derived from it. */
    countdownStartedAt: null,
    wins: wins || {},
    /** Handle for the tick interval. Never sent to a client. */
    timer: null,
  };
  // Stamp the countdown start here: createDuel is the only path into the
  // countdown phase, and the remaining number is derived from this timestamp.
  if (state.phase === "countdown") state.countdownStartedAt = Date.now();
  state.food = placeFood(occupied(state), FOOD_COUNT);
  return state;
}

function nextDir(snake) {
  const queued = snake.queued.slice();
  let dir = snake.dir;
  while (queued.length) {
    const nd = queued.shift();
    if (nd.x + dir.x !== 0 || nd.y + dir.y !== 0) {
      dir = nd;
      break;
    }
  }
  return { dir, queued };
}

function bumpWins(wins, winner) {
  if (!winner) return wins;
  const next = Object.assign({}, wins);
  next[winner] = (next[winner] || 0) + 1;
  return next;
}

function resolveOutcome(state) {
  const alive = state.snakes.filter((s) => s.alive);
  if (alive.length > 1) {
    if (state.tick >= MAX_TICKS) {
      const best = Math.max.apply(null, state.snakes.map((s) => s.score));
      const leaders = state.snakes.filter((s) => s.score === best);
      const winner = leaders.length === 1 ? leaders[0].userId : null;
      state.phase = "over";
      state.winner = winner;
      state.wins = bumpWins(state.wins, winner);
    }
    return state;
  }
  if (alive.length === 1) {
    state.phase = "over";
    state.winner = alive[0].userId;
    state.wins = bumpWins(state.wins, state.winner);
    return state;
  }
  state.phase = "over";
  state.winner = null;
  return state;
}

/** Advance one tick, mutating in place — this runs on a timer, not per event. */
function step(state) {
  if (state.phase === "countdown") {
    // Derived from a timestamp, NOT decremented per tick. The board ticks every
    // 160ms, so counting down one per tick made 3-2-1 take about half a second.
    const elapsed = Date.now() - (state.countdownStartedAt || Date.now());
    const remaining = Math.max(0, 3 - Math.floor(elapsed / COUNTDOWN_STEP_MS));
    state.countdown = remaining;
    if (remaining <= 0) {
      state.phase = "playing";
      state.countdown = 0;
    }
    return state;
  }
  if (state.phase !== "playing") return state;

  const dirs = state.snakes.map((s) =>
    s.alive ? nextDir(s) : { dir: s.dir, queued: s.queued },
  );
  const heads = state.snakes.map((s, i) =>
    s.alive ? { x: s.body[0].x + dirs[i].dir.x, y: s.body[0].y + dirs[i].dir.y } : s.body[0],
  );
  const eats = state.snakes.map(
    (s, i) => s.alive && state.food.some((f) => samePos(f, heads[i])),
  );
  // Bodies as they will be after this tick's tail movement.
  const futureBodies = state.snakes.map((s, i) =>
    !s.alive ? s.body : eats[i] ? s.body : s.body.slice(0, -1),
  );

  const deaths = state.snakes.map(() => null);
  // Protection covers snake-vs-snake only; walls and your own body still kill.
  const shielded = state.tick < SPAWN_PROTECT_TICKS;
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const head = heads[i];
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      deaths[i] = "wall";
      return;
    }
    if (futureBodies[i].some((c) => samePos(c, head))) {
      deaths[i] = "self";
      return;
    }
    if (shielded) return;
    for (let j = 0; j < state.snakes.length; j++) {
      if (j === i || !state.snakes[j].alive) continue;
      if (samePos(head, heads[j])) {
        deaths[i] = "head-on";
        return;
      }
    }
    for (let j = 0; j < state.snakes.length; j++) {
      if (j === i) continue;
      if (futureBodies[j].some((c) => samePos(c, head))) {
        deaths[i] = "opponent";
        return;
      }
    }
  });

  state.food = state.food.filter(
    (f) => !heads.some((h, i) => state.snakes[i].alive && samePos(f, h)),
  );

  state.snakes = state.snakes.map((s, i) => {
    if (!s.alive) return s;
    if (deaths[i]) {
      return Object.assign({}, s, {
        dir: dirs[i].dir,
        queued: dirs[i].queued,
        alive: false,
        causeOfDeath: deaths[i],
      });
    }
    return Object.assign({}, s, {
      body: [heads[i]].concat(futureBodies[i]),
      dir: dirs[i].dir,
      queued: dirs[i].queued,
      score: eats[i] ? s.score + 1 : s.score,
    });
  });

  state.tick += 1;

  if (state.food.length < FOOD_COUNT) {
    state.food = state.food.concat(
      placeFood(occupied(state).concat(state.food), FOOD_COUNT - state.food.length),
    );
  }

  return resolveOutcome(state);
}

function stopTimer(state) {
  if (state && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/**
 * Run the tick loop. Stops itself the moment the duel ends, so an abandoned room
 * isn't burning a timer until the sweeper reaps it.
 */
function startTimer(ctx) {
  // Read through ctx.room.state, NOT ctx.state: ctx captured the state object as
  // it was when the event arrived, and setState has since replaced it. Writing
  // the handle to the stale object leaves the live one with timer: null, so
  // stopTimer can never clear the interval.
  const state = ctx.room.state;
  stopTimer(state);
  state.timer = setInterval(() => {
    // ctx.room.state is re-read each tick: a rematch replaces the object, and a
    // stale closure would keep advancing the previous duel.
    const live = ctx.room.state;
    if (!live || (live.phase !== "playing" && live.phase !== "countdown")) {
      stopTimer(live);
      return;
    }
    step(live);
    if (live.phase === "over") stopTimer(live);
    ctx.broadcast();
  }, TICK_MS);
  if (state.timer.unref) state.timer.unref();
}

function connectedIds(room) {
  return Array.from(room.players.values())
    .filter((p) => p.connected)
    .map((p) => p.id);
}

module.exports = {
  slug: "snake-duel",
  minPlayers: 2,

  createState(room) {
    return createDuel(connectedIds(room).slice(0, MAX_PLAYERS), {});
  },

  /** The timer handle must never be serialised to a client. */
  publicState(room, state) {
    return {
      phase: state.phase,
      snakes: state.snakes.map((s) => ({
        userId: s.userId,
        body: s.body,
        alive: s.alive,
        score: s.score,
        causeOfDeath: s.causeOfDeath,
      })),
      food: state.food,
      tick: state.tick,
      winner: state.winner,
      countdown: state.countdown,
      wins: state.wins,
      cols: COLS,
      rows: ROWS,
      protectedTicks: Math.max(0, SPAWN_PROTECT_TICKS - state.tick),
      tickMs: TICK_MS,
    };
  },

  onEvent(ctx, event, data) {
    const state = ctx.state;

    switch (event) {
      case "start": {
        if (!ctx.isHost) return false;
        if (state.phase === "playing" || state.phase === "countdown") return false;
        const ids = connectedIds(ctx.room).slice(0, MAX_PLAYERS);
        if (ids.length < 2) {
          ctx.emitToPlayer("room_error", { message: "Needs at least 2 players" });
          return false;
        }
        stopTimer(state);
        ctx.setState(createDuel(ids, state.wins, "countdown"));
        startTimer(ctx);
        return true;
      }

      case "turn": {
        if (state.phase !== "playing" && state.phase !== "countdown") return false;
        const d = data && data.dir;
        if (!d || typeof d.x !== "number" || typeof d.y !== "number") return false;
        // Only the four unit directions — a crafted payload must not teleport.
        const legal = Object.keys(DIRS).some((k) => DIRS[k].x === d.x && DIRS[k].y === d.y);
        if (!legal) return false;

        const snake = state.snakes.find((s) => s.userId === ctx.userId);
        if (!snake || !snake.alive) return false;
        if (snake.queued.length >= 2) return false;
        snake.queued.push({ x: d.x, y: d.y });
        // The tick loop broadcasts; skipping it here avoids a burst of frames
        // when someone taps the keys quickly.
        return false;
      }

      case "again": {
        if (!ctx.isHost || state.phase !== "over") return false;
        const ids = connectedIds(ctx.room).slice(0, MAX_PLAYERS);
        if (ids.length < 2) {
          ctx.emitToPlayer("room_error", { message: "Need 2 players for a rematch" });
          return false;
        }
        stopTimer(state);
        ctx.setState(createDuel(ids, state.wins, "countdown"));
        startTimer(ctx);
        return true;
      }

      default:
        return false;
    }
  },

  /**
   * Freeze the board. Snake's state is already a plain snapshot of cells and
   * directions, so stopping the tick is the whole job — there is no elapsed
   * fraction to bank the way the Double It clock has.
   */
  onPause(ctx) {
    stopTimer(ctx.state);
  },

  onResume(ctx) {
    const state = ctx.room.state;
    if (!state || (state.phase !== "playing" && state.phase !== "countdown")) return;
    startTimer(ctx);
  },

  /** A duel with a departed player can't continue; award it to whoever remains. */
  onPlayerLeave(ctx, userId) {
    const state = ctx.state;
    if (!state) return;
    if (state.phase !== "playing" && state.phase !== "countdown") return;

    const snake = state.snakes.find((s) => s.userId === userId);
    if (!snake) return;
    snake.alive = false;
    snake.causeOfDeath = snake.causeOfDeath || "wall";
    resolveOutcome(state);
    stopTimer(state);
  },
};
