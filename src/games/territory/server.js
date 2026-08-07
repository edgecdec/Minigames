/**
 * Land Grab room handlers — territory capture, free-for-all.
 *
 * Server-authoritative like Snake: the server owns the tick, the trails, the
 * flood-fill claim and the collisions. A client only ever sends a direction.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated from logic.ts. That file is the source of truth and has the tests —
 * change one, change both.
 *
 * TWO deliberate differences from logic.ts, both forced by this file's job:
 *
 * 1. No `Set` anywhere in state. Room snapshots are JSON, and a Set serialises to
 *    `{}` — a paused room would come back with everyone holding nothing. The grid
 *    is the single source of truth here and counts are derived from it.
 * 2. The grid goes over the wire run-length encoded. 1600 raw ints at ~9Hz is a
 *    few KB per client per tick for a board that is mostly long uniform runs.
 */

const COLS = 40;
const ROWS = 40;
const TICK_MS = 110;
/** Wall-clock length of each countdown number, so 3-2-1 takes ~3 real seconds. */
const COUNTDOWN_STEP_MS = 1000;
const ENEMY_SLOWDOWN = 3;
const MAX_PLAYERS = 8;
const SPAWN_BLOCK = 1;
const SPAWN_PROTECT_TICKS = Math.round(3000 / TICK_MS);
const SPAWN_MARGIN = 5;
const MIN_SPAWN_GAP = 10;
/** Below this, two starting blocks would overlap and erase each other. */
const MIN_BLOCK_GAP = 2 * SPAWN_BLOCK + 1;

const WALL = -1;
const OPEN = 0;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const ROUND_SECONDS_OPTIONS = [60, 120, 180, 300];
const DEFAULT_ROUND_SECONDS = 180;

const idx = (x, y) => y * COLS + x;
const inBounds = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const ownerOf = (i) => i + 1;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ---------------------------------------------------------------- maps

function blankRows() {
  const rows = [];
  for (let y = 0; y < ROWS; y++) rows.push(" ".repeat(COLS));
  return rows;
}

const MAPS = [
  { name: "Open Field", rows: blankRows() },
  {
    name: "Four Corners",
    rows: blankRows().map((row, y) => {
      if (!((y >= 8 && y <= 13) || (y >= 26 && y <= 31))) return row;
      const cells = row.split("");
      for (let x = 8; x <= 13; x++) cells[x] = "#";
      for (let x = 26; x <= 31; x++) cells[x] = "#";
      return cells.join("");
    }),
  },
  {
    name: "The Pillar",
    rows: blankRows().map((row, y) => {
      if (y < 14 || y > 25) return row;
      if (y >= 19 && y <= 20) return row; // gaps, so the middle isn't a trap
      const cells = row.split("");
      for (let x = 14; x <= 25; x++) cells[x] = "#";
      return cells.join("");
    }),
  },
];

function buildGrid(map) {
  const grid = new Array(COLS * ROWS).fill(OPEN);
  for (let y = 0; y < ROWS; y++) {
    const row = map.rows[y] || "";
    for (let x = 0; x < COLS; x++) {
      if (row[x] === "#") grid[idx(x, y)] = WALL;
    }
  }
  return grid;
}

// ---------------------------------------------------------------- spawns

function pickSpawns(count, grid, existing) {
  const chosen = (existing || []).slice();
  const added = [];
  const span = COLS - SPAWN_MARGIN * 2;

  const blockClear = (at) => {
    for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
      for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!inBounds(x, y) || grid[idx(x, y)] === WALL) return false;
      }
    }
    return true;
  };

  for (let i = 0; i < count; i++) {
    let best = null;
    // Relax towards MIN_BLOCK_GAP, never past it.
    for (let gap = MIN_SPAWN_GAP; gap >= MIN_BLOCK_GAP && !best; gap--) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const at = {
          x: SPAWN_MARGIN + Math.floor(Math.random() * span),
          y: SPAWN_MARGIN + Math.floor(Math.random() * span),
        };
        if (!blockClear(at)) continue;
        if (chosen.every((c) => chebyshev(c, at) >= gap)) {
          best = at;
          break;
        }
      }
    }
    if (!best) {
      outer: for (let y = SPAWN_BLOCK; y < ROWS - SPAWN_BLOCK; y++) {
        for (let x = SPAWN_BLOCK; x < COLS - SPAWN_BLOCK; x++) {
          const at = { x, y };
          if (blockClear(at) && chosen.every((c) => chebyshev(c, at) >= MIN_BLOCK_GAP)) {
            best = at;
            break outer;
          }
        }
      }
    }
    const at = best || { x: SPAWN_MARGIN, y: SPAWN_MARGIN };
    chosen.push(at);
    added.push(at);
  }
  return added;
}

function room(grid, at, dir) {
  let n = 0;
  let x = at.x + dir.x;
  let y = at.y + dir.y;
  while (inBounds(x, y) && grid[idx(x, y)] !== WALL) {
    n++;
    x += dir.x;
    y += dir.y;
  }
  return n;
}

function facingOpen(grid, at) {
  const runway = [
    { dir: DIRS.right, room: room(grid, at, DIRS.right) },
    { dir: DIRS.left, room: room(grid, at, DIRS.left) },
    { dir: DIRS.down, room: room(grid, at, DIRS.down) },
    { dir: DIRS.up, room: room(grid, at, DIRS.up) },
  ];
  runway.sort((a, b) => b.room - a.room);
  return runway[0].dir;
}

function claimSpawnBlock(state, playerIndex, at) {
  const mark = ownerOf(playerIndex);
  for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
    for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!inBounds(x, y) || state.grid[idx(x, y)] === WALL) continue;
      state.grid[idx(x, y)] = mark;
    }
  }
}

/** Cells held, counted off the grid — the only source of truth here. */
function cellsOf(state, playerIndex) {
  const mark = ownerOf(playerIndex);
  let n = 0;
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i] === mark) n++;
  return n;
}

// ---------------------------------------------------------------- rules

function createGame(userIds, opts) {
  const o = opts || {};
  const map = MAPS.find((m) => m.name === o.mapName) || MAPS[0];
  const ids = userIds.slice(0, MAX_PLAYERS);
  const grid = buildGrid(map);
  const spawns = pickSpawns(ids.length, grid);
  const roundSeconds = o.roundSeconds || DEFAULT_ROUND_SECONDS;

  const state = {
    phase: o.phase || "waiting",
    grid,
    players: ids.map((userId, i) => ({
      userId,
      trail: [],
      at: spawns[i],
      dir: DIRS.right,
      queued: [],
      stallTicks: 0,
      resetAtTick: null,
      timesReset: 0,
      everClaimed: 0,
    })),
    mapName: map.name,
    settings: {
      mapName: map.name,
      raidingAllowed: o.raidingAllowed !== false,
      roundSeconds,
    },
    tick: 0,
    ticksLeft: Math.ceil((roundSeconds * 1000) / TICK_MS),
    countdownStartedAt: null,
    countdown: 3,
    raidingAllowed: o.raidingAllowed !== false,
    winner: null,
    standings: null,
    // Session wins, carried across rematches like Snake's.
    wins: o.wins || {},
    timer: null,
  };

  ids.forEach((_, i) => claimSpawnBlock(state, i, spawns[i]));
  ids.forEach((_, i) => {
    state.players[i].dir = facingOpen(state.grid, state.players[i].at);
  });
  if (state.phase === "countdown") state.countdownStartedAt = Date.now();
  return state;
}

/** Indices the border flood fill cannot reach — i.e. enclosed. */
function enclosedCells(grid, isBoundary) {
  const reach = new Uint8Array(COLS * ROWS);
  const stack = [];
  const push = (x, y) => {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (reach[i] || isBoundary(i)) return;
    reach[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < COLS; x++) {
    push(x, 0);
    push(x, ROWS - 1);
  }
  for (let y = 0; y < ROWS; y++) {
    push(0, y);
    push(COLS - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % COLS;
    const y = (i - x) / COLS;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  const out = [];
  for (let i = 0; i < grid.length; i++) if (!reach[i] && !isBoundary(i)) out.push(i);
  return out;
}

function closeLoop(state, playerIndex) {
  const land = state.players[playerIndex];
  const mark = ownerOf(playerIndex);
  let gained = 0;

  const take = (i) => {
    if (state.grid[i] === WALL) return;
    if (state.grid[i] === mark) return;
    state.grid[i] = mark;
    gained++;
  };

  for (const c of land.trail) take(idx(c.x, c.y));
  const boundary = (i) => state.grid[i] === mark || state.grid[i] === WALL;
  for (const i of enclosedCells(state.grid, boundary)) take(i);

  land.trail = [];
  land.everClaimed += gained;
  return gained;
}

function resetPlayer(state, playerIndex) {
  const land = state.players[playerIndex];
  const mark = ownerOf(playerIndex);
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] === mark) state.grid[i] = OPEN;
  }
  land.trail = [];
  land.stallTicks = 0;
  land.timesReset++;
  land.resetAtTick = state.tick;

  const others = state.players.filter((_, i) => i !== playerIndex).map((p) => p.at);
  const spawn = pickSpawns(1, state.grid, others)[0];
  land.at = spawn;
  land.dir = facingOpen(state.grid, spawn);
  land.queued = [];
  claimSpawnBlock(state, playerIndex, spawn);
}

function resolveOutcome(state) {
  const standings = state.players
    .map((p, i) => ({ userId: p.userId, cells: cellsOf(state, i), timesReset: p.timesReset }))
    .sort((a, b) => b.cells - a.cells);
  state.standings = standings;
  state.phase = "over";
  // A tie for first crowns nobody: the room counts wins off this field, and
  // awarding it to whoever sorted first would be arbitrary.
  state.winner =
    standings.length > 0 && (standings.length === 1 || standings[0].cells > standings[1].cells)
      ? standings[0].userId
      : null;
  if (state.winner) {
    state.wins[state.winner] = (state.wins[state.winner] || 0) + 1;
  }
  return state;
}

function step(state) {
  if (state.phase === "countdown") {
    // Wall clock, not tick count: at 110ms a tick-based 3-2-1 would flash past in
    // a third of a second. Snake had exactly this bug.
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

  state.tick++;
  state.ticksLeft = Math.max(0, state.ticksLeft - 1);
  const protectedNow = state.tick < SPAWN_PROTECT_TICKS;

  state.players.forEach((land, i) => {
    if (land.stallTicks > 0) {
      land.stallTicks--;
      return;
    }
    if (land.queued.length) land.dir = land.queued.shift();

    const next = { x: land.at.x + land.dir.x, y: land.at.y + land.dir.y };
    // Walls and edges stop you rather than killing you: this is a land game, and
    // dying to geometry you were shepherded into feels arbitrary.
    if (!inBounds(next.x, next.y) || state.grid[idx(next.x, next.y)] === WALL) return;

    const mark = ownerOf(i);
    const owner = state.grid[idx(next.x, next.y)];

    if (land.trail.some((c) => c.x === next.x && c.y === next.y)) {
      resetPlayer(state, i);
      return;
    }
    if (!state.raidingAllowed && owner !== OPEN && owner !== mark) return;

    land.at = next;
    if (owner === mark) {
      if (land.trail.length) closeLoop(state, i);
    } else {
      land.trail.push({ x: next.x, y: next.y });
      // Enemy ground costs the NEXT tick, not this one — you already paid to be here.
      if (owner !== OPEN) land.stallTicks = ENEMY_SLOWDOWN - 1;
    }
  });

  if (!protectedNow) {
    // Collected then applied, so two players cutting each other in one tick both
    // take it rather than the lower index winning by accident.
    const doomed = new Set();
    state.players.forEach((attacker, ai) => {
      state.players.forEach((victim, vi) => {
        if (ai === vi || !victim.trail.length) return;
        if (victim.trail.some((c) => c.x === attacker.at.x && c.y === attacker.at.y)) {
          doomed.add(vi);
        }
      });
    });
    for (const vi of doomed) resetPlayer(state, vi);
  }

  if (state.ticksLeft <= 0) return resolveOutcome(state);
  return state;
}

// ---------------------------------------------------------------- wire format

/**
 * Run-length encode the grid as a flat [value, runLength, value, runLength, ...].
 *
 * The board is mostly long uniform runs, so this is typically an order of
 * magnitude smaller than 1600 raw ints — which matters at ~9 broadcasts a second
 * per client.
 */
function packGrid(grid) {
  const out = [];
  let run = 1;
  for (let i = 1; i <= grid.length; i++) {
    if (i < grid.length && grid[i] === grid[i - 1]) {
      run++;
    } else {
      out.push(grid[i - 1], run);
      run = 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- timer

function stopTimer(state) {
  if (state && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function startTimer(ctx) {
  // Read through ctx.room.state, NOT ctx.state: ctx captured the state as it was
  // when the event arrived, and setState has since replaced it. Writing the handle
  // to the stale object leaves the live one with timer: null, so stopTimer can
  // never clear the interval.
  const state = ctx.room.state;
  stopTimer(state);
  state.timer = setInterval(() => {
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
  slug: "territory",
  minPlayers: 2,

  createState(room) {
    return createGame(connectedIds(room).slice(0, MAX_PLAYERS), {});
  },

  /** The timer handle must never be serialised to a client. */
  publicState(room, state) {
    return {
      phase: state.phase,
      grid: packGrid(state.grid),
      players: state.players.map((p, i) => ({
        userId: p.userId,
        at: p.at,
        trail: p.trail,
        cells: cellsOf(state, i),
        stalled: p.stallTicks > 0,
        timesReset: p.timesReset,
        everClaimed: p.everClaimed,
      })),
      mapName: state.mapName,
      settings: state.settings,
      options: {
        mapNames: MAPS.map((m) => m.name),
        roundSeconds: ROUND_SECONDS_OPTIONS,
      },
      tick: state.tick,
      ticksLeft: state.ticksLeft,
      secondsLeft: Math.ceil((state.ticksLeft * TICK_MS) / 1000),
      countdown: state.countdown,
      winner: state.winner,
      standings: state.standings,
      wins: state.wins,
      raidingAllowed: state.raidingAllowed,
      cols: COLS,
      rows: ROWS,
      /** Total claimable ground, so a client can show a share without the grid. */
      claimable: state.grid.filter((v) => v !== WALL).length,
      protectedTicks: Math.max(0, SPAWN_PROTECT_TICKS - state.tick),
      tickMs: TICK_MS,
    };
  },

  onEvent(ctx, event, data) {
    const state = ctx.state;

    switch (event) {
      case "settings": {
        if (!ctx.isHost) return false;
        // Lobby only: changing the map mid-round would rebuild the grid underneath
        // everyone standing on it.
        if (state.phase === "playing" || state.phase === "countdown") return false;
        const d = data || {};
        const next = { ...state.settings };
        if (typeof d.mapName === "string" && MAPS.some((m) => m.name === d.mapName)) {
          next.mapName = d.mapName;
        }
        if (typeof d.raidingAllowed === "boolean") next.raidingAllowed = d.raidingAllowed;
        if (ROUND_SECONDS_OPTIONS.includes(d.roundSeconds)) next.roundSeconds = d.roundSeconds;
        ctx.setState({ ...state, settings: next });
        return true;
      }

      case "start": {
        if (!ctx.isHost) return false;
        if (state.phase === "playing" || state.phase === "countdown") return false;
        const ids = connectedIds(ctx.room).slice(0, MAX_PLAYERS);
        if (ids.length < 2) {
          ctx.emitToPlayer("room_error", { message: "Needs at least 2 players" });
          return false;
        }
        stopTimer(state);
        ctx.setState(
          createGame(ids, {
            ...state.settings,
            wins: state.wins,
            phase: "countdown",
          }),
        );
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

        const land = state.players.find((p) => p.userId === ctx.userId);
        if (!land) return false;
        if (land.queued.length >= 2) return false;
        const last = land.queued.length ? land.queued[land.queued.length - 1] : land.dir;
        if (d.x === last.x && d.y === last.y) return false;
        // Reversal relative to the QUEUED direction: two keys in one tick must not
        // fold a player back onto their own trail.
        if (d.x === -last.x && d.y === -last.y) return false;
        land.queued.push({ x: d.x, y: d.y });
        // The tick loop broadcasts; skipping it here avoids a burst of frames when
        // someone taps the keys quickly.
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
        ctx.setState(
          createGame(ids, {
            ...state.settings,
            wins: state.wins,
            phase: "countdown",
          }),
        );
        startTimer(ctx);
        return true;
      }

      default:
        return false;
    }
  },

  /**
   * Freeze the board. Like Snake, the state is already a plain snapshot of cells
   * and directions, so stopping the tick is the whole job — there is no elapsed
   * fraction to bank the way the Double It clock has.
   *
   * `ticksLeft` is a count rather than a deadline precisely so a pause can't eat
   * the round timer.
   */
  onPause(ctx) {
    stopTimer(ctx.state);
  },

  onResume(ctx) {
    const state = ctx.room.state;
    if (!state) return;
    if (state.phase !== "playing" && state.phase !== "countdown") return;
    // Re-base the countdown, or a long pause would swallow the whole 3-2-1.
    if (state.phase === "countdown") {
      state.countdownStartedAt = Date.now() - (3 - state.countdown) * COUNTDOWN_STEP_MS;
    }
    startTimer(ctx);
  },

  /**
   * A departed player's land is released rather than left as a frozen wall nobody
   * can take. The round continues — unlike the duels, this game is still playable
   * with one fewer person.
   */
  onPlayerLeave(ctx, userId) {
    const state = ctx.state;
    if (!state) return;
    const i = state.players.findIndex((p) => p.userId === userId);
    if (i === -1) return;

    const mark = ownerOf(i);
    for (let n = 0; n < state.grid.length; n++) {
      if (state.grid[n] === mark) state.grid[n] = OPEN;
    }
    state.players.splice(i, 1);

    // Owner markers are positional, so removing a player would silently reassign
    // everyone after them to the wrong land. Renumber the grid to match.
    for (let n = 0; n < state.grid.length; n++) {
      const v = state.grid[n];
      if (v > mark) state.grid[n] = v - 1;
    }

    if (state.players.length < 2 && state.phase === "playing") {
      resolveOutcome(state);
      stopTimer(state);
    }
  },
};
