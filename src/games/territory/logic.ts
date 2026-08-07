/**
 * "Land Grab" — territory capture on a square grid. Pure rules, no DOM, no sockets.
 *
 * Free-for-all. Every cell you step on becomes yours PERMANENTLY, and the round
 * ends when the board is full (or the clock runs out, whichever comes first).
 * Most ground wins.
 *
 * WHY THERE ARE NO TRAILS. The first version was paper.io-style: leaving your
 * land drew a trail, getting home claimed the loop, and cutting someone's trail
 * sent them back to a fresh spawn. That made respawning load-bearing, and a
 * respawn has to find somewhere to put you, wipe your land, and decide what
 * happens to a half-drawn loop — a lot of machinery whose failure modes all land
 * on the player. Claiming as you walk gets the same "carve out territory" feel
 * with no trail to cut, nothing to reset, and no respawn at all.
 *
 * You therefore cannot lose ground by being caught. The two ways the board still
 * changes hands:
 *
 * - **Enclosure.** Seal a region off and everything inside it becomes yours,
 *   including an opponent's cells. Surrounding someone is the skill.
 * - **Raiding** (optional). With it on you may overwrite enemy cells, but you
 *   crawl while standing on them. With it off enemy land is solid — nobody can
 *   lose a single cell except by being enclosed.
 *
 * Enclosure is a flood fill inward from the board edge: anything the fill cannot
 * reach is sealed. That handles a pocket bounded by any mix of your own land and
 * map walls without special-casing shapes, which is what lets the maps be
 * arbitrary silhouettes rather than rectangles.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Dir {
  x: number;
  y: number;
}

/**
 * Base tick. Slower than Snake's 160ms because a territory board is bigger and
 * the interesting decisions are route-planning rather than reflexes.
 */
export const TICK_MS = 110;

/**
 * Default ticks spent standing still for each step taken on enemy ground.
 *
 * A stall rather than a second timer: the player still moves on the same tick
 * loop, just not every tick. Configurable per round — see `ENEMY_SLOWDOWN_OPTIONS`.
 */
export const ENEMY_SLOWDOWN = 3;

/**
 * Selectable raid speeds, as the stall applied per enemy cell.
 *
 * 1 means no penalty at all (raiding is free), 5 makes a deep raid a serious
 * commitment. Offered as a lobby setting because how punishing raiding should be
 * is the main thing that changes how the game plays.
 */
export const ENEMY_SLOWDOWN_OPTIONS = [1, 2, 3, 4, 5] as const;

/**
 * Selectable spawn-protection lengths, in seconds.
 *
 * NOT a respawn timer — nothing respawns any more, because a claimed cell is
 * permanent and no player can ever be reset. This only covers the opening
 * window, so a raider can't reach someone's starting block before they have had
 * a chance to move.
 */
export const SPAWN_PROTECT_OPTIONS = [0, 3, 5, 10] as const;

/** Fallback round length; the lobby can pick another. */
export const ROUND_SECONDS = 180;

export const MAX_PLAYERS = 8;

/** Half-width of the square each player starts holding. 1 => a 3x3 block. */
export const SPAWN_BLOCK = 1;

/** Default spawn protection, in ticks. */
export const SPAWN_PROTECT_TICKS = Math.round(3000 / TICK_MS);

/** Convert a seconds setting into ticks. */
export const protectTicksFor = (seconds: number): number =>
  Math.round((seconds * 1000) / TICK_MS);

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

/** Grid marker for a wall cell. */
export const WALL = -1;
/** Grid marker for unclaimed ground. */
export const OPEN = 0;

// ---------------------------------------------------------------- maps

/**
 * A board. Dimensions are per-map so a six-player game can have somewhere to go.
 *
 * A shape is described either as `art` (rows of text, `#` = wall) or as a `mask`
 * predicate returning true where the cell is PLAYABLE. Predicates are used for
 * the silhouettes: forty hand-drawn rows of ASCII is unreadable and gets a limb
 * wrong, whereas composed ellipses and triangles are obvious and scale.
 */
export interface TerritoryMap {
  name: string;
  cols: number;
  rows: number;
  /** How many players this board comfortably fits — shown in the lobby. */
  bestFor: string;
  art?: string[];
  mask?: (x: number, y: number, cols: number, rows: number) => boolean;
}

const ellipse = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** A cone opening downward from `apex`, `spread` cells wider per row. */
const cone = (
  x: number,
  y: number,
  apexX: number,
  apexY: number,
  height: number,
  spread: number,
): boolean =>
  y >= apexY && y <= apexY + height && Math.abs(x - apexX) <= (y - apexY) * spread;

export const MAPS: TerritoryMap[] = [
  {
    // The baseline, and the fairest for a first round.
    name: "Open Field",
    cols: 40,
    rows: 40,
    bestFor: "2-4",
    mask: () => true,
  },
  {
    // Four blocks that break sight lines and make natural chokepoints.
    name: "Four Corners",
    cols: 40,
    rows: 40,
    bestFor: "2-4",
    mask: (x, y) => {
      const block = (x0: number, y0: number) =>
        x >= x0 && x <= x0 + 5 && y >= y0 && y <= y0 + 5;
      return !(block(8, 8) || block(26, 8) || block(8, 26) || block(26, 26));
    },
  },
  {
    // A central pillar with a gap, so the middle is contested but not a trap.
    name: "The Pillar",
    cols: 40,
    rows: 40,
    bestFor: "2-4",
    mask: (x, y) => !(x >= 14 && x <= 25 && y >= 14 && y <= 25 && !(y >= 19 && y <= 20)),
  },
  {
    // Big and empty: room for a full lobby to spread out before meeting.
    name: "The Arena",
    cols: 60,
    rows: 48,
    bestFor: "5-8",
    mask: () => true,
  },
  {
    // Concentric rings with staggered doorways — long routes and real ambushes.
    name: "Spiral Vault",
    cols: 56,
    rows: 48,
    bestFor: "4-8",
    mask: (x, y, cols, rows) => {
      // Integer centre. Using (cols-1)/2 put the centre on a half-cell, so every
      // `ring` came out as x.5, the `ring % 6 === 3` test never matched, and the
      // map rendered with no walls whatsoever.
      const cx = Math.floor(cols / 2);
      const cy = Math.floor(rows / 2);
      const ring = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      // Only rings that fit ENTIRELY on the board.
      //
      // A ring wider than the board stops being a ring: at radius 27 on a 56x48
      // board it degenerates into two bare vertical lines, and the one on the left
      // has no doorway — which sealed off the x=0 column and left 48 of 2233 cells
      // reachable. The board could then never fill, so the round never ended that
      // way. The connectivity test caught this; playing it would not have.
      const maxRing = Math.min(cx, cy, cols - 1 - cx, rows - 1 - cy);
      if (ring > maxRing) return true;
      // A wall every 6 cells out from the centre.
      if (ring % 6 !== 3) return true;
      // One doorway per ring, on a different side each time, so getting inward
      // means walking most of the way around.
      const n = Math.floor(ring / 6);
      const side = n % 4;
      if (side === 0) return Math.abs(y - cy) <= 2 && x > cx;
      if (side === 1) return Math.abs(x - cx) <= 2 && y > cy;
      if (side === 2) return Math.abs(y - cy) <= 2 && x < cx;
      return Math.abs(x - cx) <= 2 && y < cy;
    },
  },
  {
    // A cat: head, two ears, and a pair of cheeks.
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
    // A dog: round head, floppy ears down the sides, and a snout.
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

/** Widest and tallest map, so callers can size buffers without scanning. */
export const MAX_COLS = MAPS.reduce((n, m) => Math.max(n, m.cols), 0);
export const MAX_ROWS = MAPS.reduce((n, m) => Math.max(n, m.rows), 0);

// ---------------------------------------------------------------- state

/** A player's position and pace. No trail, because nothing draws one. */
export interface Land {
  userId: string;
  at: Cell;
  dir: Dir;
  queued: Dir[];
  /** Counts down while crossing enemy ground; the player holds still until 0. */
  stallTicks: number;
  /** Cells taken over the whole round, including ones later enclosed away. */
  everClaimed: number;
  /** Cells taken by sealing a region, for an end-of-round stat. */
  enclosed: number;
}

export type Phase = "waiting" | "countdown" | "playing" | "over";

export interface TerritoryState {
  phase: Phase;
  /**
   * Ownership grid, row-major, `rows * cols` entries. WALL, OPEN, or a 1-based
   * index into `players`.
   *
   * A flat array of small ints rather than per-player Sets: it serialises
   * compactly, and "who owns this cell" is the question asked most per tick.
   */
  grid: number[];
  cols: number;
  rows: number;
  players: Land[];
  mapName: string;
  tick: number;
  /** Ticks remaining. A COUNT, not a deadline, so a pause can't eat the round. */
  ticksLeft: number;
  /** Wall clock, so the 3-2-1 runs on real seconds rather than ticks. */
  countdownStartedAt: number | null;
  countdown: number;
  raidingAllowed: boolean;
  /** Stall applied per enemy cell entered. 1 = no penalty. */
  enemySlowdown: number;
  /** Ticks of opening protection; 0 disables it. */
  protectTicks: number;
  winner: string | null;
  /**
   * Final table. `rank` is competition-style, so equal scores SHARE a place and
   * the next distinct score skips: 1, T2, T2, 4 rather than 1, 2, 3, 4. Inventing
   * an order between genuinely equal players is just a lie about the result.
   */
  standings:
    | { userId: string; cells: number; enclosed: number; rank: number; tied: boolean }[]
    | null;
  /** Why the round ended, so the UI can say so. */
  endReason: "full" | "time" | "stalled" | null;
  tickMs: number;
}

export const key = (c: Cell): string => `${c.x},${c.y}`;
export const idxIn = (cols: number, x: number, y: number): number => y * cols + x;
export const inBoundsOf = (cols: number, rows: number, x: number, y: number): boolean =>
  x >= 0 && x < cols && y >= 0 && y < rows;

/** 1-based owner marker for a player index, so 0 can mean OPEN. */
export const ownerOf = (playerIndex: number): number => playerIndex + 1;

export function isProtected(state: TerritoryState): boolean {
  return state.tick < state.protectTicks;
}

export function protectionLeft(state: TerritoryState): number {
  return Math.max(0, state.protectTicks - state.tick);
}

/** Build a map's starting grid. `art` wins over `mask` when both are given. */
export function buildGrid(map: TerritoryMap): number[] {
  const { cols, rows } = map;
  const grid = new Array<number>(cols * rows).fill(OPEN);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const playable = map.art
        ? (map.art[y] ?? "")[x] !== "#"
        : map.mask
          ? map.mask(x, y, cols, rows)
          : true;
      if (!playable) grid[idxIn(cols, x, y)] = WALL;
    }
  }
  return grid;
}

export function findMap(name: string | undefined): TerritoryMap {
  return MAPS.find((m) => m.name === name) ?? MAPS[0];
}

// ---------------------------------------------------------------- spawns

const SPAWN_MARGIN = 4;
/** Below this two starting blocks would overlap and erase each other. */
const MIN_BLOCK_GAP = 2 * SPAWN_BLOCK + 1;

const chebyshev = (a: Cell, b: Cell): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Spawn points: spaced apart, never on a wall, never overlapping.
 *
 * The gap relaxes on a crowded or wall-heavy board but stops at MIN_BLOCK_GAP —
 * it used to relax to 0, which let two players spawn on one cell so the second
 * block erased the first and that player began holding nothing.
 */
export function pickSpawns(
  count: number,
  grid: number[],
  cols: number,
  rows: number,
  rng: () => number = Math.random,
  existing: Cell[] = [],
): Cell[] {
  const chosen = existing.slice();
  const added: Cell[] = [];

  const blockClear = (at: Cell): boolean => {
    for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
      for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!inBoundsOf(cols, rows, x, y) || grid[idxIn(cols, x, y)] === WALL) return false;
      }
    }
    return true;
  };

  // Aim for a spread that scales with the board, so a big map doesn't cram
  // everyone into one corner.
  const target = Math.max(MIN_BLOCK_GAP, Math.floor(Math.min(cols, rows) / 4));

  for (let i = 0; i < count; i++) {
    let best: Cell | null = null;
    for (let gap = target; gap >= MIN_BLOCK_GAP && !best; gap--) {
      for (let attempt = 0; attempt < 250; attempt++) {
        const at = {
          x: SPAWN_MARGIN + Math.floor(rng() * Math.max(1, cols - SPAWN_MARGIN * 2)),
          y: SPAWN_MARGIN + Math.floor(rng() * Math.max(1, rows - SPAWN_MARGIN * 2)),
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
    const at = best ?? { x: SPAWN_MARGIN, y: SPAWN_MARGIN };
    chosen.push(at);
    added.push(at);
  }
  return added;
}

function claimSpawnBlock(state: TerritoryState, playerIndex: number, at: Cell): void {
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

function room(state: TerritoryState, at: Cell, dir: Dir): number {
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

/** Face whichever way has the most room, so the first move isn't into a wall. */
function facingOpen(state: TerritoryState, at: Cell): Dir {
  const runway = [
    { dir: DIRS.right as Dir, room: room(state, at, DIRS.right) },
    { dir: DIRS.left as Dir, room: room(state, at, DIRS.left) },
    { dir: DIRS.down as Dir, room: room(state, at, DIRS.down) },
    { dir: DIRS.up as Dir, room: room(state, at, DIRS.up) },
  ];
  runway.sort((a, b) => b.room - a.room);
  return runway[0].dir;
}

export function createGame(
  userIds: string[],
  opts: {
    rng?: () => number;
    mapName?: string;
    raidingAllowed?: boolean;
    roundSeconds?: number;
    enemySlowdown?: number;
    protectSeconds?: number;
    phase?: Phase;
  } = {},
): TerritoryState {
  const rng = opts.rng ?? Math.random;
  const map = findMap(opts.mapName);
  const ids = userIds.slice(0, MAX_PLAYERS);
  const grid = buildGrid(map);
  const roundSeconds = opts.roundSeconds ?? ROUND_SECONDS;

  const state: TerritoryState = {
    phase: opts.phase ?? "waiting",
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
    tick: 0,
    ticksLeft: Math.ceil((roundSeconds * 1000) / TICK_MS),
    countdownStartedAt: null,
    countdown: 3,
    raidingAllowed: opts.raidingAllowed ?? true,
    // Clamped to the offered values so a crafted payload can't make a raid free
    // or protection permanent.
    enemySlowdown: (ENEMY_SLOWDOWN_OPTIONS as readonly number[]).includes(
      opts.enemySlowdown ?? ENEMY_SLOWDOWN,
    )
      ? (opts.enemySlowdown ?? ENEMY_SLOWDOWN)
      : ENEMY_SLOWDOWN,
    protectTicks: protectTicksFor(
      (SPAWN_PROTECT_OPTIONS as readonly number[]).includes(opts.protectSeconds ?? 3)
        ? (opts.protectSeconds ?? 3)
        : 3,
    ),
    winner: null,
    standings: null,
    endReason: null,
    tickMs: TICK_MS,
  };

  const spawns = pickSpawns(ids.length, grid, map.cols, map.rows, rng);
  ids.forEach((_, i) => {
    state.players[i].at = spawns[i];
    claimSpawnBlock(state, i, spawns[i]);
  });
  ids.forEach((_, i) => {
    state.players[i].dir = facingOpen(state, state.players[i].at);
  });
  return state;
}

/**
 * Queue a direction change.
 *
 * Queued rather than applied immediately so two keys in one tick can't skip a
 * cell.
 *
 * REVERSING IS ALLOWED, anywhere. Snake forbids it because backing into your own
 * body kills you, and the first version of this game inherited that rule for a
 * trail that no longer exists. Now that a claimed cell is permanent there is
 * nothing behind you to hurt you, so refusing the input just made the controls
 * feel broken — you would press left, nothing happened, and you kept walking into
 * a wall. Turning around on your own ground is the obvious case, and it turns out
 * to be safe on open and enemy ground too.
 */
export function queueTurn(state: TerritoryState, userId: string, dir: Dir): TerritoryState {
  const land = state.players.find((p) => p.userId === userId);
  if (!land) return state;
  const last = land.queued.length ? land.queued[land.queued.length - 1] : land.dir;
  // Same direction is still a no-op; there is nothing to change.
  if (dir.x === last.x && dir.y === last.y) return state;
  if (land.queued.length >= 2) return state;
  land.queued.push(dir);
  return state;
}

/**
 * Indices the flood fill cannot reach — i.e. sealed off by the player's own land.
 *
 * The fill starts from every WALL-FREE cell on the border AND spreads through
 * walls, treating them as outside. That matters enormously on a shaped map: the
 * whole border of the Cat is wall, so a fill seeded only on non-wall border cells
 * never starts, every playable cell reads as "enclosed", and the first player to
 * move instantly claims the entire board and ends the round. That really happened.
 *
 * So: walls are traversable by the fill (they are outside the shape), but are
 * never claimed. A pocket is only enclosed when the PLAYER'S OWN LAND ring seals
 * it — which is the rule the game actually wants.
 */
export function enclosedCells(
  grid: number[],
  cols: number,
  rows: number,
  isBoundary: (index: number) => boolean,
): number[] {
  const reach = new Uint8Array(cols * rows);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (!inBoundsOf(cols, rows, x, y)) return;
    const i = idxIn(cols, x, y);
    if (reach[i]) return;
    // Walls conduct the fill instead of blocking it: on a silhouette the outside
    // of the shape IS wall, so blocking here left the fill with nowhere to start.
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
    const i = stack.pop()!;
    const x = i % cols;
    const y = (i - x) / cols;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    // Unreached and not part of the sealing ring itself. Walls are never claimed,
    // so they are excluded even when the fill could not reach them.
    if (!reach[i] && !isBoundary(i) && grid[i] !== WALL) out.push(i);
  }
  return out;
}

/**
 * Absorb anything this player has sealed off. Returns how many cells changed.
 *
 * The ONLY way ground changes hands without being walked on, and the only way a
 * player can lose ground at all when raiding is off.
 */
export function absorbEnclosed(state: TerritoryState, playerIndex: number): number {
  const mark = ownerOf(playerIndex);
  const boundary = (i: number) => state.grid[i] === mark || state.grid[i] === WALL;
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

/** Cells a player currently holds. */
export function cellsOf(state: TerritoryState, userId: string): number {
  const i = state.players.findIndex((p) => p.userId === userId);
  if (i < 0) return 0;
  const mark = ownerOf(i);
  let n = 0;
  for (let k = 0; k < state.grid.length; k++) if (state.grid[k] === mark) n++;
  return n;
}

/** Cells nobody owns yet. Zero means the board is full. */
export function openCells(state: TerritoryState): number {
  let n = 0;
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i] === OPEN) n++;
  return n;
}

/**
 * Advance one tick.
 *
 * Every player moves, and every cell moved onto is claimed for good. There are no
 * collisions to resolve: two players can occupy the same cell, and the second one
 * simply takes it. That is a deliberate simplification — with nothing to reset,
 * a collision has no consequence worth modelling.
 */
export function step(state: TerritoryState, rng: () => number = Math.random): TerritoryState {
  void rng; // no respawns any more; kept so callers don't have to change
  if (state.phase === "playing") {
    state.tick++;
    state.ticksLeft = Math.max(0, state.ticksLeft - 1);

    const claimers = new Set<number>();

    state.players.forEach((land, i) => {
      if (land.stallTicks > 0) {
        land.stallTicks--;
        return;
      }
      if (land.queued.length) land.dir = land.queued.shift()!;

      const next = { x: land.at.x + land.dir.x, y: land.at.y + land.dir.y };
      // Walls and edges STOP you rather than killing you: this is a land game,
      // and dying to geometry you were funnelled into feels arbitrary.
      if (!inBoundsOf(state.cols, state.rows, next.x, next.y)) return;
      const ni = idxIn(state.cols, next.x, next.y);
      if (state.grid[ni] === WALL) return;

      const mark = ownerOf(i);
      const owner = state.grid[ni];

      // Raiding off: enemy ground is solid, so nobody can lose a cell by being
      // walked over — only by being enclosed.
      if (!state.raidingAllowed && owner !== OPEN && owner !== mark) return;

      land.at = next;
      if (owner !== mark) {
        state.grid[ni] = mark;
        land.everClaimed++;
        claimers.add(i);
        // Enemy ground costs the NEXT tick, not this one — you already paid to be
        // here. Charged only when taking a cell off someone, not on open ground.
        if (owner !== OPEN) land.stallTicks = Math.max(0, state.enemySlowdown - 1);
      }
    });

    // Only players who actually took a cell can have sealed anything, so the fill
    // runs at most once per mover rather than once per player per tick.
    for (const i of claimers) absorbEnclosed(state, i);

    // Board full is the natural end: there is nothing left to play for.
    if (openCells(state) === 0) return resolveOutcome(state, "full");
    if (state.ticksLeft <= 0) return resolveOutcome(state, "time");
  }
  return state;
}

/** Rank by held cells and set the winner. A tie for first leaves it null. */
export function resolveOutcome(
  state: TerritoryState,
  reason: "full" | "time" | "stalled" = "time",
): TerritoryState {
  const scored = state.players
    .map((p) => ({ userId: p.userId, cells: cellsOf(state, p.userId), enclosed: p.enclosed }))
    .sort((a, b) => b.cells - a.cells);

  // Competition ranking: equal scores share a place, and the place after a tie
  // skips by however many were tied.
  const standings = scored.map((row) => {
    const firstEqual = scored.findIndex((r) => r.cells === row.cells);
    const equalCount = scored.filter((r) => r.cells === row.cells).length;
    return { ...row, rank: firstEqual + 1, tied: equalCount > 1 };
  });

  state.standings = standings;
  state.phase = "over";
  state.endReason = reason;
  // A tie for first crowns nobody: the room counts wins off this field, and
  // awarding it to whoever sorted first would be arbitrary.
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
