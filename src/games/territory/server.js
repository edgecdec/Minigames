/**
 * Land Grab room handlers — territory capture, free-for-all.
 *
 * Server-authoritative like Snake: the server owns the tick, the claiming, the
 * flood fill and the round end. A client only ever sends a direction.
 *
 * CommonJS, loaded by server.js outside the webpack build, so the rules are
 * duplicated from logic.ts. That file is the source of truth and has the tests —
 * change one, change both.
 *
 * Deliberate differences from logic.ts, both forced by this file's job:
 *
 * 1. No `Set` or `Map` in state. Room snapshots are JSON and a Set serialises to
 *    `{}`, so a paused room would come back with everyone holding nothing. The
 *    grid is the single source of truth and counts are derived from it.
 * 2. The grid goes over the wire run-length encoded. A 60x48 board is 2880 raw
 *    ints at ~9Hz per client, for something that is mostly long uniform runs.
 *
 * THERE ARE NO TRAILS AND NO RESPAWNS. Every cell you step on is yours for good.
 * The earlier paper.io-style version cut trails and sent players back to a fresh
 * spawn, which made respawning load-bearing — and a respawn has to find a free
 * spot, wipe your land and decide what happens to a half-drawn loop. Claiming as
 * you walk gets the same feel with none of that machinery.
 */

const TICK_MS = 110;
/** Wall-clock length of each countdown number, so 3-2-1 takes ~3 real seconds. */
const COUNTDOWN_STEP_MS = 1000;
const ENEMY_SLOWDOWN = 3;
/** Selectable raid speeds: the stall applied per enemy cell. 1 = free. */
const ENEMY_SLOWDOWN_OPTIONS = [1, 2, 3, 4, 5];
/**
 * Selectable spawn-protection lengths, in seconds.
 *
 * NOT a respawn timer — nothing respawns, because a claimed cell is permanent and
 * no player is ever reset. This is only the opening window.
 */
const SPAWN_PROTECT_OPTIONS = [0, 3, 5, 10];
const DEFAULT_PROTECT_SECONDS = 3;
const MAX_PLAYERS = 8;
const SPAWN_BLOCK = 1;
const SPAWN_PROTECT_TICKS = Math.round(3000 / TICK_MS);
const protectTicksFor = (seconds) => Math.round((seconds * 1000) / TICK_MS);
/** Keep a setting inside its allow-list, whatever a client sent. */
const pick = (options, value, fallback) =>
  options.includes(value) ? value : fallback;
const SPAWN_MARGIN = 4;
/** Below this two starting blocks would overlap and erase each other. */
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

const idxIn = (cols, x, y) => y * cols + x;
const inBoundsOf = (cols, rows, x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
const ownerOf = (i) => i + 1;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ---------------------------------------------------------------- maps

const ellipse = (x, y, cx, cy, rx, ry) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** A cone opening downward from the apex, `spread` cells wider per row. */
const cone = (x, y, apexX, apexY, height, spread) =>
  y >= apexY && y <= apexY + height && Math.abs(x - apexX) <= (y - apexY) * spread;

/**
 * Boards, with per-map dimensions so a full lobby has somewhere to go.
 *
 * Shapes are predicates returning true where a cell is PLAYABLE rather than rows
 * of ASCII: forty hand-drawn rows is unreadable and gets a limb wrong, whereas
 * composed ellipses and cones are obvious and scale. Mirrors logic.ts.
 */
const MAPS = [
  { name: "Open Field", cols: 40, rows: 40, bestFor: "2-4", mask: () => true },
  {
    name: "Four Corners",
    cols: 40,
    rows: 40,
    bestFor: "2-4",
    mask: (x, y) => {
      const block = (x0, y0) => x >= x0 && x <= x0 + 5 && y >= y0 && y <= y0 + 5;
      return !(block(8, 8) || block(26, 8) || block(8, 26) || block(26, 26));
    },
  },
  {
    name: "The Pillar",
    cols: 40,
    rows: 40,
    bestFor: "2-4",
    mask: (x, y) => !(x >= 14 && x <= 25 && y >= 14 && y <= 25 && !(y >= 19 && y <= 20)),
  },
  { name: "The Arena", cols: 60, rows: 48, bestFor: "5-8", mask: () => true },
  {
    name: "Spiral Vault",
    cols: 56,
    rows: 48,
    bestFor: "4-8",
    mask: (x, y, cols, rows) => {
      // Integer centre: (cols-1)/2 put it on a half-cell so every ring came out
      // x.5, the wall test never matched, and the map had no walls at all.
      const cx = Math.floor(cols / 2);
      const cy = Math.floor(rows / 2);
      const ring = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      // Only rings that fit ENTIRELY on the board: a wider one degenerates into
      // two bare lines, one of which has no doorway, sealing off a sliver of the
      // map. Mirrors logic.ts.
      const maxRing = Math.min(cx, cy, cols - 1 - cx, rows - 1 - cy);
      if (ring > maxRing) return true;
      if (ring % 6 !== 3) return true;
      const n = Math.floor(ring / 6);
      const side = n % 4;
      if (side === 0) return Math.abs(y - cy) <= 2 && x > cx;
      if (side === 1) return Math.abs(x - cx) <= 2 && y > cy;
      if (side === 2) return Math.abs(y - cy) <= 2 && x < cx;
      return Math.abs(x - cx) <= 2 && y < cy;
    },
  },
  {
    name: "Cat",
    cols: 52,
    rows: 48,
    bestFor: "4-8",
    mask: (x, y) =>
      ellipse(x, y, 26, 28, 20, 17) ||
      cone(x, y, 13, 4, 14, 0.62) ||
      cone(x, y, 39, 4, 14, 0.62) ||
      ellipse(x, y, 12, 33, 7, 6) ||
      ellipse(x, y, 40, 33, 7, 6),
  },
  {
    name: "Dog",
    cols: 56,
    rows: 50,
    bestFor: "4-8",
    mask: (x, y) =>
      ellipse(x, y, 28, 22, 16, 15) ||
      ellipse(x, y, 8, 26, 7, 15) ||
      ellipse(x, y, 48, 26, 7, 15) ||
      ellipse(x, y, 28, 40, 10, 8),
  },
];

function findMap(name) {
  return MAPS.find((m) => m.name === name) || MAPS[0];
}

function buildGrid(map) {
  const { cols, rows } = map;
  const grid = new Array(cols * rows).fill(OPEN);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!map.mask(x, y, cols, rows)) grid[idxIn(cols, x, y)] = WALL;
    }
  }
  return grid;
}

// ---------------------------------------------------------------- spawns

function pickSpawns(count, grid, cols, rows, existing) {
  const chosen = (existing || []).slice();
  const added = [];

  const blockClear = (at) => {
    for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
      for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!inBoundsOf(cols, rows, x, y) || grid[idxIn(cols, x, y)] === WALL) return false;
      }
    }
    return true;
  };

  // Scale the spread with the board so a big map doesn't cram everyone together.
  const target = Math.max(MIN_BLOCK_GAP, Math.floor(Math.min(cols, rows) / 4));

  for (let i = 0; i < count; i++) {
    let best = null;
    // Relax towards MIN_BLOCK_GAP, never past it: below that, blocks overlap and
    // the second one erases the first.
    for (let gap = target; gap >= MIN_BLOCK_GAP && !best; gap--) {
      for (let attempt = 0; attempt < 250; attempt++) {
        const at = {
          x: SPAWN_MARGIN + Math.floor(Math.random() * Math.max(1, cols - SPAWN_MARGIN * 2)),
          y: SPAWN_MARGIN + Math.floor(Math.random() * Math.max(1, rows - SPAWN_MARGIN * 2)),
        };
        if (!blockClear(at)) continue;
        if (chosen.every((c) => chebyshev(c, at) >= gap)) {
          best = at;
          break;
        }
      }
    }
    // Deterministic fallback, so a dense silhouette can't spin forever.
    if (!best) {
      outer: for (let y = SPAWN_BLOCK; y < rows - SPAWN_BLOCK; y++) {
        for (let x = SPAWN_BLOCK; x < cols - SPAWN_BLOCK; x++) {
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

function claimSpawnBlock(state, playerIndex, at) {
  const mark = ownerOf(playerIndex);
  for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
    for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!inBoundsOf(state.cols, state.rows, x, y)) continue;
      const i = idxIn(state.cols, x, y);
      if (state.grid[i] === WALL) continue;
      state.grid[i] = mark;
    }
  }
}

function cellsAt(state, playerIndex) {
  const mark = ownerOf(playerIndex);
  let n = 0;
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i] === mark) n++;
  return n;
}

function openCells(state) {
  let n = 0;
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i] === OPEN) n++;
  return n;
}

function room(state, at, dir) {
  let n = 0;
  let x = at.x + dir.x;
  let y = at.y + dir.y;
  while (
    inBoundsOf(state.cols, state.rows, x, y) &&
    state.grid[idxIn(state.cols, x, y)] !== WALL
  ) {
    n++;
    x += dir.x;
    y += dir.y;
  }
  return n;
}

function facingOpen(state, at) {
  const runway = [
    { dir: DIRS.right, room: room(state, at, DIRS.right) },
    { dir: DIRS.left, room: room(state, at, DIRS.left) },
    { dir: DIRS.down, room: room(state, at, DIRS.down) },
    { dir: DIRS.up, room: room(state, at, DIRS.up) },
  ];
  runway.sort((a, b) => b.room - a.room);
  return runway[0].dir;
}

// ---------------------------------------------------------------- rules

function createGame(userIds, opts) {
  const o = opts || {};
  const map = findMap(o.mapName);
  const ids = userIds.slice(0, MAX_PLAYERS);
  const grid = buildGrid(map);
  const roundSeconds = o.roundSeconds || DEFAULT_ROUND_SECONDS;

  const state = {
    phase: o.phase || "waiting",
    grid,
    cols: map.cols,
    rows: map.rows,
    players: ids.map((userId) => ({
      userId,
      at: { x: SPAWN_MARGIN, y: SPAWN_MARGIN },
      dir: DIRS.right,
      queued: [],
      stallTicks: 0,
      everClaimed: 0,
      enclosed: 0,
    })),
    mapName: map.name,
    settings: {
      mapName: map.name,
      raidingAllowed: o.raidingAllowed !== false,
      roundSeconds,
      enemySlowdown: pick(ENEMY_SLOWDOWN_OPTIONS, o.enemySlowdown, ENEMY_SLOWDOWN),
      protectSeconds: pick(SPAWN_PROTECT_OPTIONS, o.protectSeconds, DEFAULT_PROTECT_SECONDS),
    },
    tick: 0,
    // A COUNT, not a deadline, so a pause or a deploy can't eat the round.
    ticksLeft: Math.ceil((roundSeconds * 1000) / TICK_MS),
    countdownStartedAt: null,
    countdown: 3,
    raidingAllowed: o.raidingAllowed !== false,
    // Re-validated here rather than trusted: settings arrive from a client.
    enemySlowdown: pick(ENEMY_SLOWDOWN_OPTIONS, o.enemySlowdown, ENEMY_SLOWDOWN),
    protectTicks: protectTicksFor(
      pick(SPAWN_PROTECT_OPTIONS, o.protectSeconds, DEFAULT_PROTECT_SECONDS),
    ),
    winner: null,
    standings: null,
    endReason: null,
    // Session wins, carried across rematches like Snake's.
    wins: o.wins || {},
    timer: null,
  };

  const spawns = pickSpawns(ids.length, grid, map.cols, map.rows);
  ids.forEach((_, i) => {
    state.players[i].at = spawns[i];
    claimSpawnBlock(state, i, spawns[i]);
  });
  ids.forEach((_, i) => {
    state.players[i].dir = facingOpen(state, state.players[i].at);
  });
  if (state.phase === "countdown") state.countdownStartedAt = Date.now();
  return state;
}

/** Indices the border flood fill cannot reach — i.e. sealed off. */
function enclosedCells(grid, cols, rows, isBoundary) {
  const reach = new Uint8Array(cols * rows);
  const stack = [];
  const push = (x, y) => {
    if (!inBoundsOf(cols, rows, x, y)) return;
    const i = idxIn(cols, x, y);
    if (reach[i]) return;
    // Walls conduct the fill rather than blocking it: on a silhouette the whole
    // border is wall, so a fill that stopped at walls never started, every cell
    // read as enclosed, and the first mover claimed the entire board.
    if (grid[i] !== WALL && isBoundary(i)) return;
    reach[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < cols; x++) {
    push(x, 0);
    push(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    push(0, y);
    push(cols - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols;
    const y = (i - x) / cols;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  const out = [];
  for (let i = 0; i < grid.length; i++) {
    // Unreached, not the sealing ring, and never a wall.
    if (!reach[i] && !isBoundary(i) && grid[i] !== WALL) out.push(i);
  }
  return out;
}

/**
 * Absorb anything this player has sealed off.
 *
 * The ONLY way ground changes hands without being walked on, and the only way a
 * player can lose ground at all when raiding is off.
 */
function absorbEnclosed(state, playerIndex) {
  const mark = ownerOf(playerIndex);
  const boundary = (i) => state.grid[i] === mark || state.grid[i] === WALL;
  const sealed = enclosedCells(state.grid, state.cols, state.rows, boundary);
  let gained = 0;
  for (const i of sealed) {
    if (state.grid[i] === WALL || state.grid[i] === mark) continue;
    state.grid[i] = mark;
    gained++;
  }
  if (gained) {
    state.players[playerIndex].enclosed += gained;
    state.players[playerIndex].everClaimed += gained;
  }
  return gained;
}

function resolveOutcome(state, reason) {
  const scored = state.players
    .map((p, i) => ({ userId: p.userId, cells: cellsAt(state, i), enclosed: p.enclosed }))
    .sort((a, b) => b.cells - a.cells);

  // Competition ranking: equal scores SHARE a place and the next distinct score
  // skips (1, T2, T2, 4). Inventing an order between equal players is a lie.
  state.standings = scored.map((row) => {
    const firstEqual = scored.findIndex((r) => r.cells === row.cells);
    const equalCount = scored.filter((r) => r.cells === row.cells).length;
    return { ...row, rank: firstEqual + 1, tied: equalCount > 1 };
  });

  state.phase = "over";
  state.endReason = reason || "time";
  // A tie for first crowns nobody: the room counts wins off this field.
  state.winner =
    scored.length > 0 && (scored.length === 1 || scored[0].cells > scored[1].cells)
      ? scored[0].userId
      : null;
  if (state.winner) {
    state.wins[state.winner] = (state.wins[state.winner] || 0) + 1;
  }
  return state;
}

function step(state) {
  if (state.phase === "countdown") {
    // Wall clock, not tick count: at 110ms a tick-based 3-2-1 flashes past in a
    // third of a second. Snake had exactly this bug.
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

  const claimers = [];

  state.players.forEach((land, i) => {
    if (land.stallTicks > 0) {
      land.stallTicks--;
      return;
    }
    if (land.queued.length) land.dir = land.queued.shift();

    const next = { x: land.at.x + land.dir.x, y: land.at.y + land.dir.y };
    // Walls and edges STOP you rather than killing you: this is a land game, and
    // dying to geometry you were funnelled into feels arbitrary.
    if (!inBoundsOf(state.cols, state.rows, next.x, next.y)) return;
    const ni = idxIn(state.cols, next.x, next.y);
    if (state.grid[ni] === WALL) return;

    const mark = ownerOf(i);
    const owner = state.grid[ni];

    // Raiding off: enemy ground is solid, so nobody loses a cell by being walked
    // over — only by being enclosed.
    if (!state.raidingAllowed && owner !== OPEN && owner !== mark) return;

    land.at = next;
    if (owner !== mark) {
      state.grid[ni] = mark;
      land.everClaimed++;
      if (!claimers.includes(i)) claimers.push(i);
      // Enemy ground costs the NEXT tick, not this one — you already paid to be
      // here. Charged only when taking a cell off someone.
      if (owner !== OPEN) land.stallTicks = Math.max(0, state.enemySlowdown - 1);
    }
  });

  // Only a player who actually took a cell can have sealed anything.
  for (const i of claimers) absorbEnclosed(state, i);

  // Board full is the natural end: there is nothing left to play for.
  if (openCells(state) === 0) return resolveOutcome(state, "full");
  if (state.ticksLeft <= 0) return resolveOutcome(state, "time");
  return state;
}

// ---------------------------------------------------------------- wire format

/**
 * Run-length encode the grid as [value, runLength, value, runLength, ...].
 *
 * A 60x48 board is 2880 raw ints, mostly in long uniform runs, and this goes out
 * at ~9Hz per client.
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
        cells: cellsAt(state, i),
        stalled: p.stallTicks > 0,
        everClaimed: p.everClaimed,
        enclosed: p.enclosed,
      })),
      mapName: state.mapName,
      cols: state.cols,
      rows: state.rows,
      settings: state.settings,
      options: {
        maps: MAPS.map((m) => ({
          name: m.name,
          cols: m.cols,
          rows: m.rows,
          bestFor: m.bestFor,
        })),
        mapNames: MAPS.map((m) => m.name),
        roundSeconds: ROUND_SECONDS_OPTIONS,
        enemySlowdown: ENEMY_SLOWDOWN_OPTIONS,
        protectSeconds: SPAWN_PROTECT_OPTIONS,
      },
      tick: state.tick,
      ticksLeft: state.ticksLeft,
      secondsLeft: Math.ceil((state.ticksLeft * TICK_MS) / 1000),
      countdown: state.countdown,
      winner: state.winner,
      standings: state.standings,
      endReason: state.endReason,
      wins: state.wins,
      raidingAllowed: state.raidingAllowed,
      /** Total claimable ground, so a client can show a share without the grid. */
      claimable: state.grid.filter((v) => v !== WALL).length,
      openCells: openCells(state),
      protectedTicks: Math.max(0, (state.protectTicks ?? SPAWN_PROTECT_TICKS) - state.tick),
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
        const next = Object.assign({}, state.settings);
        if (typeof d.mapName === "string" && MAPS.some((m) => m.name === d.mapName)) {
          next.mapName = d.mapName;
        }
        if (typeof d.raidingAllowed === "boolean") next.raidingAllowed = d.raidingAllowed;
        if (ROUND_SECONDS_OPTIONS.includes(d.roundSeconds)) next.roundSeconds = d.roundSeconds;
        if (ENEMY_SLOWDOWN_OPTIONS.includes(d.enemySlowdown)) next.enemySlowdown = d.enemySlowdown;
        if (SPAWN_PROTECT_OPTIONS.includes(d.protectSeconds)) next.protectSeconds = d.protectSeconds;
        // Rebuild so the lobby previews the chosen board rather than the old one.
        ctx.setState(
          createGame(connectedIds(ctx.room).slice(0, MAX_PLAYERS), {
            ...next,
            wins: state.wins,
          }),
        );
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
          createGame(ids, { ...state.settings, wins: state.wins, phase: "countdown" }),
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
        // Same direction is a no-op. REVERSING IS ALLOWED: with no trail there is
        // nothing behind you to hit, and refusing it made the controls feel broken.
        if (d.x === last.x && d.y === last.y) return false;
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
          createGame(ids, { ...state.settings, wins: state.wins, phase: "countdown" }),
        );
        startTimer(ctx);
        return true;
      }

      default:
        return false;
    }
  },

  /**
   * Freeze the board. The state is already a plain snapshot of cells and
   * directions, so stopping the tick is the whole job — there is no elapsed
   * fraction to bank the way the Double It clock has.
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
   * can take. The round continues — unlike the duels, this is still playable with
   * one fewer person.
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

    // Owner markers are POSITIONAL, so removing a player would silently reassign
    // everyone after them to the wrong land. Renumber the grid to match.
    for (let n = 0; n < state.grid.length; n++) {
      const v = state.grid[n];
      if (v > mark) state.grid[n] = v - 1;
    }

    if (state.players.length < 2 && state.phase === "playing") {
      resolveOutcome(state, "stalled");
      stopTimer(state);
    }
  },
};
