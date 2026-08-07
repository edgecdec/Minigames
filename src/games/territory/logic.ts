/**
 * "Land Grab" — territory capture on a square grid. Pure rules, no DOM, no sockets.
 *
 * Free-for-all. You are safe inside your OWN territory and can drive into open
 * ground; leaving your land starts a trail, and getting back to your own land
 * closes the loop and claims everything the loop encircles. Whoever holds the
 * most ground when the round timer expires wins — the timer exists so nobody can
 * win instantly, and so a stalemate still ends.
 *
 * Two rules give the game its teeth:
 *
 * - **Enemy ground is slower.** You may cut through someone else's territory,
 *   but you move at a fraction of the pace while standing on it. Taking land off
 *   a strong player is possible and expensive, which is the whole risk/reward.
 * - **Your land is your weapon.** If someone trespasses and you hit their trail
 *   before they get home, they are fully reset — trail gone, territory back to a
 *   fresh spawn block. Defending is an action, not just a hope.
 *
 * The claim is a flood fill from the board edge: anything the fill cannot reach
 * is enclosed, so an encircled pocket of open ground (or an opponent's land) is
 * absorbed automatically without special-casing shapes.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Dir {
  x: number;
  y: number;
}

export const COLS = 40;
export const ROWS = 40;

/**
 * Base tick. Slower than Snake's 160ms because a territory board is bigger and
 * the interesting decisions are route-planning rather than reflexes.
 */
export const TICK_MS = 110;

/**
 * Ticks spent standing still for each step taken on enemy ground.
 *
 * A multiplier rather than a separate timer: the player still moves every N
 * ticks, so nothing about the tick loop changes. 3 makes a raid feel genuinely
 * committing without being unplayable.
 */
export const ENEMY_SLOWDOWN = 3;

/** Round length. Long enough to build, short enough to stay tense. */
export const ROUND_SECONDS = 180;
export const MAX_TICKS = Math.ceil((ROUND_SECONDS * 1000) / TICK_MS);

export const MAX_PLAYERS = 8;

/** Half-width of the square each player starts holding. 1 => a 3x3 block. */
export const SPAWN_BLOCK = 1;

/**
 * Ticks of spawn protection, mirroring Snake's reasoning: random spawns can drop
 * two players close together, and being reset in the first second by someone you
 * never saw is the worst possible start. Protected players can't be reset and
 * can't reset others, but they DO move.
 */
export const SPAWN_PROTECT_TICKS = Math.round(3000 / TICK_MS);

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

const KEY_MAP: Record<string, Dir> = {
  ArrowUp: DIRS.up,
  ArrowDown: DIRS.down,
  ArrowLeft: DIRS.left,
  ArrowRight: DIRS.right,
  w: DIRS.up,
  s: DIRS.down,
  a: DIRS.left,
  d: DIRS.right,
};

export function dirForKey(key: string): Dir | undefined {
  return KEY_MAP[key] ?? KEY_MAP[key.toLowerCase()];
}

/** Grid marker for a wall cell in a map's rows. */
export const WALL = -1;
/** Grid marker for unclaimed ground. */
export const OPEN = 0;

/**
 * Hand-designed maps. Rows are strings so a layout can be read and edited as a
 * picture; `#` is a wall and anything else is open ground.
 *
 * A map is padded and cropped to COLS x ROWS on load, so a layout that is the
 * wrong size degrades rather than corrupting the grid.
 */
export interface TerritoryMap {
  name: string;
  rows: string[];
}

/** Build a map's rows from a compact spec, so layouts stay readable here. */
function box(width: number, height: number, holes: string[] = []): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(holes[y] ?? " ".repeat(width));
  }
  return rows;
}

export const MAPS: TerritoryMap[] = [
  {
    // Nothing in the way: the baseline, and the fairest for a first round.
    name: "Open Field",
    rows: box(COLS, ROWS),
  },
  {
    // Four blocks that break line of sight and create natural chokepoints.
    name: "Four Corners",
    rows: box(COLS, ROWS).map((row, y) => {
      const on = (y >= 8 && y <= 13) || (y >= 26 && y <= 31);
      if (!on) return row;
      const cells = row.split("");
      for (let x = 8; x <= 13; x++) cells[x] = "#";
      for (let x = 26; x <= 31; x++) cells[x] = "#";
      return cells.join("");
    }),
  },
  {
    // A central pillar with gaps, so the middle is contested but not a trap.
    name: "The Pillar",
    rows: box(COLS, ROWS).map((row, y) => {
      if (y < 14 || y > 25) return row;
      // Gaps at the vertical midpoint let players slip through rather than
      // funnelling everyone into one lane.
      if (y >= 19 && y <= 20) return row;
      const cells = row.split("");
      for (let x = 14; x <= 25; x++) cells[x] = "#";
      return cells.join("");
    }),
  },
];

/**
 * A player's grid ownership plus their current excursion.
 *
 * `trail` is ordered oldest-first, which matters: closing a loop needs the path
 * as a path, not a set.
 */
export interface Land {
  userId: string;
  /** Cells this player owns. Keyed "x,y" for O(1) membership. */
  owned: Set<string>;
  /** Cells of the current excursion, empty while standing on own land. */
  trail: Cell[];
  at: Cell;
  dir: Dir;
  queued: Dir[];
  /** Counts down while crossing enemy ground; the player holds still until 0. */
  stallTicks: number;
  /** Set the tick they were reset, purely so the UI can flash it. */
  resetAtTick: number | null;
  /** How many times they've been sent home. */
  timesReset: number;
  /** Cells claimed over the whole round, for an end-of-round stat. */
  everClaimed: number;
}

export type Phase = "waiting" | "countdown" | "playing" | "over";

export interface TerritoryState {
  phase: Phase;
  /**
   * Ownership grid, row-major, ROWS * COLS entries. WALL, OPEN, or 1-based index
   * into `players`.
   *
   * A flat array of small ints rather than per-player Sets as the source of
   * truth: it serialises compactly for the wire, and "who owns this cell" is the
   * question asked most often per tick.
   */
  grid: number[];
  players: Land[];
  mapName: string;
  tick: number;
  /** Ticks remaining in the round. */
  ticksLeft: number;
  /** Wall-clock start, so the 3-2-1 runs on real seconds rather than ticks. */
  countdownStartedAt: number | null;
  countdown: number;
  /** True while capturing enemy land is permitted. */
  raidingAllowed: boolean;
  winner: string | null;
  /** Final standings, set when the round ends. */
  standings: { userId: string; cells: number; timesReset: number }[] | null;
  tickMs: number;
}

export const key = (c: Cell): string => `${c.x},${c.y}`;
export const idx = (x: number, y: number): number => y * COLS + x;
export const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < COLS && y >= 0 && y < ROWS;

/** 1-based owner marker for a player index, so 0 can mean OPEN. */
export const ownerOf = (playerIndex: number): number => playerIndex + 1;

export function isProtected(state: TerritoryState): boolean {
  return state.tick < SPAWN_PROTECT_TICKS;
}

export function protectionLeft(state: TerritoryState): number {
  return Math.max(0, SPAWN_PROTECT_TICKS - state.tick);
}

/** Parse a map into a fresh grid, cropping and padding to COLS x ROWS. */
export function buildGrid(map: TerritoryMap): number[] {
  const grid = new Array<number>(COLS * ROWS).fill(OPEN);
  for (let y = 0; y < ROWS; y++) {
    const row = map.rows[y] ?? "";
    for (let x = 0; x < COLS; x++) {
      if (row[x] === "#") grid[idx(x, y)] = WALL;
    }
  }
  return grid;
}

const SPAWN_MARGIN = 5;
const MIN_SPAWN_GAP = 10;
/**
 * Hard floor on spawn separation, in Chebyshev distance.
 *
 * The relaxing loop below used to bottom out at 0, which let two players spawn on
 * the SAME cell — the second player's starting block then overwrote the first's
 * and they began the round holding nothing. Chebyshev rather than Manhattan
 * because it is what actually guarantees two blocks don't overlap: (0,0) and
 * (2,1) are 3 apart by Manhattan and still share cells.
 */
const MIN_BLOCK_GAP = 2 * SPAWN_BLOCK + 1;

/**
 * Spawn points, spaced apart and never on a wall.
 *
 * Same relaxing-gap approach as Snake: try for real separation, then loosen
 * rather than spin forever on a crowded or wall-heavy map.
 */
const chebyshev = (a: Cell, b: Cell): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function pickSpawns(
  count: number,
  grid: number[],
  rng: () => number = Math.random,
): Cell[] {
  const chosen: Cell[] = [];
  const span = COLS - SPAWN_MARGIN * 2;

  const blockClear = (at: Cell): boolean => {
    // The whole starting block must be free, or a spawn would claim through a wall.
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
    let best: Cell | null = null;
    // Relax towards MIN_BLOCK_GAP, never past it: below that, blocks overlap.
    for (let gap = MIN_SPAWN_GAP; gap >= MIN_BLOCK_GAP && !best; gap--) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const at = {
          x: SPAWN_MARGIN + Math.floor(rng() * span),
          y: SPAWN_MARGIN + Math.floor(rng() * span),
        };
        if (!blockClear(at)) continue;
        const clear = chosen.every((c) => chebyshev(c, at) >= gap);
        if (clear) {
          best = at;
          break;
        }
      }
    }
    // Last resort: scan for the first cell that fits a non-overlapping block.
    // Guarantees termination on a map so dense that random sampling keeps missing,
    // and still refuses to stack two players on top of each other.
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
    chosen.push(best ?? { x: SPAWN_MARGIN, y: SPAWN_MARGIN });
  }
  return chosen;
}

/** Give a player their opening block, overwriting whatever was there. */
function claimSpawnBlock(state: TerritoryState, playerIndex: number, at: Cell): void {
  const land = state.players[playerIndex];
  const mark = ownerOf(playerIndex);
  for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
    for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!inBounds(x, y) || state.grid[idx(x, y)] === WALL) continue;
      // Take the cell off whoever held it, so counts stay in step with the grid.
      const prev = state.grid[idx(x, y)];
      if (prev !== OPEN && prev !== mark) {
        state.players[prev - 1]?.owned.delete(key({ x, y }));
      }
      state.grid[idx(x, y)] = mark;
      land.owned.add(key({ x, y }));
    }
  }
}

export function createGame(
  userIds: string[],
  opts: {
    rng?: () => number;
    mapName?: string;
    raidingAllowed?: boolean;
    roundSeconds?: number;
    phase?: Phase;
  } = {},
): TerritoryState {
  const rng = opts.rng ?? Math.random;
  const map = MAPS.find((m) => m.name === opts.mapName) ?? MAPS[0];
  const ids = userIds.slice(0, MAX_PLAYERS);
  const grid = buildGrid(map);
  const spawns = pickSpawns(ids.length, grid, rng);
  const roundSeconds = opts.roundSeconds ?? ROUND_SECONDS;

  const state: TerritoryState = {
    phase: opts.phase ?? "waiting",
    grid,
    players: ids.map((userId, i) => ({
      userId,
      owned: new Set<string>(),
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
    tick: 0,
    ticksLeft: Math.ceil((roundSeconds * 1000) / TICK_MS),
    countdownStartedAt: null,
    countdown: 3,
    raidingAllowed: opts.raidingAllowed ?? true,
    winner: null,
    standings: null,
    tickMs: TICK_MS,
  };

  ids.forEach((_, i) => claimSpawnBlock(state, i, spawns[i]));
  ids.forEach((_, i) => {
    // Face the open board so the first move isn't into a wall.
    state.players[i].dir = facingOpen(state.grid, state.players[i].at);
  });
  return state;
}

function facingOpen(grid: number[], at: Cell): Dir {
  const runway = [
    { dir: DIRS.right, room: room(grid, at, DIRS.right) },
    { dir: DIRS.left, room: room(grid, at, DIRS.left) },
    { dir: DIRS.down, room: room(grid, at, DIRS.down) },
    { dir: DIRS.up, room: room(grid, at, DIRS.up) },
  ];
  runway.sort((a, b) => b.room - a.room);
  return runway[0].dir;
}

function room(grid: number[], at: Cell, dir: Dir): number {
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

/**
 * Queue a direction change.
 *
 * Queued rather than applied so two keys in one tick can't fold a player back on
 * their own trail — the same bug Snake had. A reversal is dropped outright while
 * a trail exists, because reversing onto your own trail is instant self-death.
 */
export function queueTurn(state: TerritoryState, userId: string, dir: Dir): TerritoryState {
  const land = state.players.find((p) => p.userId === userId);
  if (!land) return state;
  const last = land.queued.length ? land.queued[land.queued.length - 1] : land.dir;
  // Same direction: nothing to do. Opposite: ignore.
  if (dir.x === last.x && dir.y === last.y) return state;
  if (dir.x === -last.x && dir.y === -last.y) return state;
  if (land.queued.length >= 2) return state;
  land.queued.push(dir);
  return state;
}

/**
 * Everything the flood fill cannot reach from the border is enclosed.
 *
 * Walls block the fill, so a pocket sealed by a mix of wall and the player's own
 * land still counts as enclosed — which is what makes hand-designed maps
 * interesting rather than a special case.
 */
export function enclosedCells(
  grid: number[],
  isBoundary: (index: number) => boolean,
): number[] {
  const reach = new Uint8Array(COLS * ROWS);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
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
    const i = stack.pop()!;
    const x = i % COLS;
    const y = (i - x) / COLS;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (!reach[i] && !isBoundary(i)) out.push(i);
  }
  return out;
}

/**
 * Close a player's loop: their trail becomes theirs, and anything the trail plus
 * their existing land encircles is absorbed.
 *
 * Walls count as boundary for the fill but are never claimed — an enclosed
 * region bounded partly by rock is still enclosed, and the rock stays rock.
 */
export function closeLoop(state: TerritoryState, playerIndex: number): number {
  const land = state.players[playerIndex];
  const mark = ownerOf(playerIndex);
  let gained = 0;

  const take = (i: number) => {
    if (state.grid[i] === WALL) return;
    const prev = state.grid[i];
    if (prev === mark) return;
    if (prev !== OPEN) {
      const x = i % COLS;
      const y = (i - x) / COLS;
      state.players[prev - 1]?.owned.delete(key({ x, y }));
    }
    state.grid[i] = mark;
    const x = i % COLS;
    const y = (i - x) / COLS;
    land.owned.add(key({ x, y }));
    gained++;
  };

  for (const c of land.trail) take(idx(c.x, c.y));

  // Boundary = this player's land (now including the trail) and walls.
  const boundary = (i: number) => state.grid[i] === mark || state.grid[i] === WALL;
  for (const i of enclosedCells(state.grid, boundary)) take(i);

  land.trail = [];
  land.everClaimed += gained;
  return gained;
}

/**
 * Send a player home: trail gone, land reduced to a fresh spawn block.
 *
 * Deliberately brutal — the reward for defending your ground has to be worth
 * chasing someone down.
 */
export function resetPlayer(
  state: TerritoryState,
  playerIndex: number,
  rng: () => number = Math.random,
): void {
  const land = state.players[playerIndex];
  const mark = ownerOf(playerIndex);

  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] === mark) state.grid[i] = OPEN;
  }
  land.owned.clear();
  land.trail = [];
  land.stallTicks = 0;
  land.timesReset++;
  land.resetAtTick = state.tick;

  const spawn = pickSpawns(1, state.grid, rng)[0];
  land.at = spawn;
  land.dir = facingOpen(state.grid, spawn);
  land.queued = [];
  claimSpawnBlock(state, playerIndex, spawn);
}

/** Cells a player currently holds. */
export function cellsOf(state: TerritoryState, userId: string): number {
  return state.players.find((p) => p.userId === userId)?.owned.size ?? 0;
}

/**
 * Advance one tick.
 *
 * Order matters and is deliberate: stalls first (so a slowed player genuinely
 * loses the tick), then movement, then trail collisions, then loop closing. A
 * player who moves onto their own land in the same tick that someone hits their
 * trail is treated as home — the mover had already committed to the safe cell.
 */
export function step(state: TerritoryState, rng: () => number = Math.random): TerritoryState {
  if (state.phase !== "playing") return state;

  state.tick++;
  state.ticksLeft = Math.max(0, state.ticksLeft - 1);

  const protectedNow = isProtected(state);

  // ---- movement ----
  state.players.forEach((land, i) => {
    if (land.stallTicks > 0) {
      land.stallTicks--;
      return;
    }
    if (land.queued.length) land.dir = land.queued.shift()!;

    const next = { x: land.at.x + land.dir.x, y: land.at.y + land.dir.y };

    // A wall or the board edge stops you dead rather than killing you: this is a
    // land game, and dying to geometry you were shepherded into feels arbitrary.
    if (!inBounds(next.x, next.y) || state.grid[idx(next.x, next.y)] === WALL) {
      return;
    }

    const mark = ownerOf(i);
    const owner = state.grid[idx(next.x, next.y)];
    const ownTrail = land.trail.some((c) => c.x === next.x && c.y === next.y);

    // Crossing your own trail is self-destruction; treat it as a reset so the
    // rule is the same however you lose your excursion.
    if (ownTrail) {
      resetPlayer(state, i, rng);
      return;
    }

    // Raiding disabled: enemy land is simply impassable, so a round can't be
    // decided by trespass at all.
    if (!state.raidingAllowed && owner !== OPEN && owner !== mark) {
      return;
    }

    land.at = next;

    if (owner === mark) {
      // Home. Any excursion now closes.
      if (land.trail.length) closeLoop(state, i);
    } else {
      land.trail.push({ ...next });
      // Enemy ground costs you speed for the NEXT tick, not this one — you have
      // already paid to be here.
      if (owner !== OPEN) land.stallTicks = ENEMY_SLOWDOWN - 1;
    }
  });

  // ---- trail collisions ----
  // Collected first, applied after, so two players cutting each other's trails in
  // the same tick both take the consequence rather than the earlier index winning.
  if (!protectedNow) {
    const doomed = new Set<number>();
    state.players.forEach((attacker, ai) => {
      state.players.forEach((victim, vi) => {
        if (ai === vi) return;
        if (!victim.trail.length) return;
        const hit = victim.trail.some(
          (c) => c.x === attacker.at.x && c.y === attacker.at.y,
        );
        if (hit) doomed.add(vi);
      });
    });
    for (const vi of doomed) resetPlayer(state, vi, rng);
  }

  if (state.ticksLeft <= 0 || state.tick >= MAX_TICKS) return resolveOutcome(state);
  return state;
}

/** Rank by held cells and set the winner. Ties leave `winner` null. */
export function resolveOutcome(state: TerritoryState): TerritoryState {
  const standings = state.players
    .map((p) => ({ userId: p.userId, cells: p.owned.size, timesReset: p.timesReset }))
    .sort((a, b) => b.cells - a.cells);

  state.standings = standings;
  state.phase = "over";
  // A tie for first has no winner: awarding it to whoever sorted first would be
  // arbitrary, and the room counts wins off this field.
  state.winner =
    standings.length > 0 && (standings.length === 1 || standings[0].cells > standings[1].cells)
      ? standings[0].userId
      : null;
  return state;
}

/** Percentage of claimable ground a player holds, for the UI. */
export function sharePercent(state: TerritoryState, userId: string): number {
  const claimable = state.grid.filter((v) => v !== WALL).length;
  if (!claimable) return 0;
  return (cellsOf(state, userId) / claimable) * 100;
}
