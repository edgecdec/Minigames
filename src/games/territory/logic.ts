/**
 * "Land Grab" — territory capture on a square grid. Pure rules, no DOM, no sockets.
 *
 * Free-for-all. Every cell you step on becomes yours, the round ends when the
 * board is full (or the clock runs out), and the most ground wins.
 *
 * TWO MODES, which is the whole difference between them:
 *
 * - **Claim** (`raidingAllowed: false`) — claims are PERMANENT. Enemy land is
 *   solid, so the only way to lose ground is to be fully surrounded. A race for
 *   open space.
 * - **Raid** (`raidingAllowed: true`) — claims are NOT permanent. You can walk
 *   over enemy cells and take them, but you crawl while you do, and the owner can
 *   catch and kill you. A fight over the same ground.
 *
 * Perma-claiming belongs to Claim mode only; saying "your cells are permanent"
 * about Raid mode would be wrong, since taking them is the entire point.
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
 * reach is sealed. Walls CONDUCT the fill (they are outside the shape) and are
 * never claimed, which is what lets the maps be arbitrary silhouettes rather than
 * rectangles.
 *
 * ONE CONSEQUENCE, worth knowing before designing a board: you cannot use an
 * obstacle as one side of an enclosure. Ring a block completely and its interior is
 * yours (measured: 64 cells); pin a pocket against the block's edge and you get
 * nothing, because the fill comes in through the rock. So walls are cover and
 * chokepoints, not free walls for your own perimeter — which also means a big open
 * void inside a shape has to be channelled to the outside, or nothing touching it
 * can ever be enclosed.
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
 * Selectable respawn delays, in seconds.
 *
 * The cost of being killed. Without a real delay, dying is nearly free and the
 * board devolves into everyone bumping each other constantly.
 */
export const RESPAWN_OPTIONS = [2, 3, 5, 8] as const;

/**
 * Cells a respawn point must keep clear of every living player.
 *
 * Coming back right next to whoever just killed you is the worst outcome: they
 * are still standing on their own ground, so they can immediately kill you again.
 * The delay alone doesn't fix that — the placement has to.
 */
export const RESPAWN_CLEARANCE = 8;

/** Fallback round length; the lobby can pick another. */
export const ROUND_SECONDS = 180;

export const MAX_PLAYERS = 8;

/** Half-width of the square each player starts holding. 1 => a 3x3 block. */
export const SPAWN_BLOCK = 1;

/** Default respawn delay, in ticks. */
export const RESPAWN_TICKS = Math.round(3000 / TICK_MS);

/** Convert a seconds setting into ticks. */
export const ticksFor = (seconds: number): number => Math.round((seconds * 1000) / TICK_MS);

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

const rect = (
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;

const disc = (x: number, y: number, cx: number, cy: number, r: number): boolean =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

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
  {
    // A blocky arcade alien. Long open arms and legs, with two vertical eye
    // channels notched OPEN to the top edge — a sealed socket would seed the flood
    // fill and break enclosure anywhere near it.
    name: "Invader",
    cols: 52,
    rows: 44,
    bestFor: "4-8",
    mask: (x, y) =>
      (rect(x, y, 10, 8, 41, 31) ||
        rect(x, y, 16, 2, 35, 8) ||
        rect(x, y, 4, 14, 10, 34) ||
        rect(x, y, 41, 14, 47, 34) ||
        rect(x, y, 12, 31, 20, 40) ||
        rect(x, y, 31, 31, 39, 40)) &&
      !rect(x, y, 19, 0, 23, 14) &&
      !rect(x, y, 28, 0, 32, 14),
  },
  {
    // Two bulbs joined by a narrow waist: everyone funnels through the middle, so
    // the waist is worth holding and worth raiding.
    name: "Hourglass",
    cols: 48,
    rows: 52,
    bestFor: "2-6",
    mask: (x, y) =>
      disc(x, y, 24, 13, 13) || disc(x, y, 24, 39, 13) || rect(x, y, 20, 12, 28, 40),
  },
  {
    // A ring. The hole is OPENED to the outside by a channel, because an enclosed
    // hole seeds the fill: you could never enclose anything touching it.
    name: "Donut",
    cols: 52,
    rows: 52,
    bestFor: "4-8",
    mask: (x, y) =>
      ellipse(x, y, 26, 26, 24, 24) &&
      !(ellipse(x, y, 26, 26, 9, 9) || rect(x, y, 24, 0, 28, 26)),
  },
  {
    // Two lobes over a taper. The point at the bottom is a dead end — easy to
    // claim, hard to escape if someone corners you there.
    name: "Heart",
    cols: 48,
    rows: 44,
    bestFor: "2-6",
    mask: (x, y) =>
      disc(x, y, 16, 14, 11) ||
      disc(x, y, 32, 14, 11) ||
      (Math.abs(x - 24) <= (40 - y) * 0.72 && y >= 14 && y <= 40),
  },
  {
    // Five spikes off a fat centre. The spike tips are cul-de-sacs, so chasing
    // someone into one is a real play.
    name: "Star",
    cols: 52,
    rows: 50,
    bestFor: "4-8",
    mask: (x, y) => {
      const cx = 26;
      const cy = 25;
      const ang = Math.atan2(y - cy, x - cx);
      const r = Math.hypot(x - cx, y - cy);
      // Radius oscillates with angle: five lobes, point-up.
      return r <= 10 + 14 * (0.5 + 0.5 * Math.cos(5 * (ang + Math.PI / 2)));
    },
  },
  {
    // Cranium and jaw. The eye sockets are notched in from the SIDES rather than
    // upward, so the forehead stays one solid mass instead of three thin strips —
    // and they still reach the outside, which keeps them out of the flood fill.
    name: "Skull",
    cols: 48,
    rows: 48,
    bestFor: "4-8",
    mask: (x, y) =>
      (ellipse(x, y, 24, 20, 18, 16) &&
        !(disc(x, y, 16, 18, 4) || rect(x, y, 0, 16, 16, 20)) &&
        !(disc(x, y, 32, 18, 4) || rect(x, y, 32, 16, 47, 20))) ||
      rect(x, y, 17, 34, 30, 42),
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
  /**
   * Tick this player comes back, or null while alive.
   *
   * Dead players don't move, don't claim, and can't be killed again.
   */
  respawnAtTick: number | null;
  /**
   * Where they will reappear, chosen the moment they die.
   *
   * Fixed at death rather than at respawn so the client can FLASH it for the whole
   * countdown — everyone can see where the fight is about to restart, instead of
   * someone materialising on top of them.
   */
  respawnAt: Cell | null;
  /** How many times they've been killed, for an end-of-round stat. */
  deaths: number;
  /** Kills they've made defending their own ground. */
  kills: number;
}

/** Alive means not waiting out a respawn. */
export const isAlive = (land: Land): boolean => land.respawnAtTick === null;

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
  /** Ticks a killed player waits before coming back. */
  respawnTicks: number;
  winner: string | null;
  /**
   * Final table. `rank` is competition-style, so equal scores SHARE a place and
   * the next distinct score skips: 1, T2, T2, 4 rather than 1, 2, 3, 4. Inventing
   * an order between genuinely equal players is just a lie about the result.
   */
  standings:
    | {
        userId: string;
        cells: number;
        enclosed: number;
        kills: number;
        deaths: number;
        rank: number;
        tied: boolean;
      }[]
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

/** Ticks until this player is back, or 0 if they're alive. */
export function respawnLeft(state: TerritoryState, land: Land): number {
  if (land.respawnAtTick === null) return 0;
  return Math.max(0, land.respawnAtTick - state.tick);
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
    respawnSeconds?: number;
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
      respawnAtTick: null,
      respawnAt: null,
      deaths: 0,
      kills: 0,
    })),
    mapName: map.name,
    tick: 0,
    ticksLeft: Math.ceil((roundSeconds * 1000) / TICK_MS),
    countdownStartedAt: null,
    countdown: 3,
    raidingAllowed: opts.raidingAllowed ?? true,
    // Clamped to the offered values so a crafted payload can't make a raid free
    // or a respawn instant.
    enemySlowdown: (ENEMY_SLOWDOWN_OPTIONS as readonly number[]).includes(
      opts.enemySlowdown ?? ENEMY_SLOWDOWN,
    )
      ? (opts.enemySlowdown ?? ENEMY_SLOWDOWN)
      : ENEMY_SLOWDOWN,
    respawnTicks: ticksFor(
      (RESPAWN_OPTIONS as readonly number[]).includes(opts.respawnSeconds ?? 3)
        ? (opts.respawnSeconds ?? 3)
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
  // Ignore input from a dead player: banked turns would fire the instant they
  // return, lurching them off in a direction they chose seconds earlier.
  if (!isAlive(land)) return state;
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
 * Pick somewhere to come back, as far from every living player as possible.
 *
 * Respawning next to whoever just killed you is the worst possible outcome: they
 * are still standing on their own ground and can kill you again immediately. So
 * this maximises the distance to the nearest living player rather than picking at
 * random, and prefers your own remaining land when it is safe — coming back on
 * ground you own means you aren't instantly a trespasser.
 */
export function pickRespawn(
  state: TerritoryState,
  playerIndex: number,
  rng: () => number = Math.random,
): Cell {
  const mark = ownerOf(playerIndex);
  const living = state.players
    .filter((p, i) => i !== playerIndex && isAlive(p))
    .map((p) => p.at);

  const nearest = (c: Cell): number =>
    living.length === 0
      ? Infinity
      : Math.min(...living.map((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y)));

  let best: Cell | null = null;
  let bestScore = -Infinity;

  // Sample rather than scan every cell: a 60x48 board is 2880 cells and this runs
  // the moment someone dies, inside a 110ms tick.
  for (let attempt = 0; attempt < 400; attempt++) {
    const c = {
      x: Math.floor(rng() * state.cols),
      y: Math.floor(rng() * state.rows),
    };
    const i = idxIn(state.cols, c.x, c.y);
    if (state.grid[i] === WALL) continue;
    const dist = nearest(c);
    // Own ground is a small bonus, but never at the cost of real distance.
    const score = Math.min(dist, RESPAWN_CLEARANCE * 3) + (state.grid[i] === mark ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
    // Good enough: stop early rather than burning the whole budget.
    if (dist >= RESPAWN_CLEARANCE * 2) break;
  }

  // Deterministic fallback so a dense board can't return null.
  if (!best) {
    for (let y = 0; y < state.rows && !best; y++) {
      for (let x = 0; x < state.cols; x++) {
        if (state.grid[idxIn(state.cols, x, y)] !== WALL) {
          best = { x, y };
          break;
        }
      }
    }
  }
  return best ?? { x: 0, y: 0 };
}

/**
 * Is `cell` inside `mark`'s territory?
 *
 * "Inside" is a question about the NEIGHBOURHOOD, not the single square underfoot.
 * A raider rewrites each cell as they enter it, so within a few ticks their own
 * trail of stolen squares makes them look like they are standing on their own
 * land — a defender could occupy the very same cell and no kill would register,
 * however closely they chased. Snapshotting ownership one tick earlier does not
 * help either: the cell changed hands ticks ago.
 *
 * A majority of the 8 neighbours (judged against `before`, the ownership at the
 * start of the tick) is robust to that thin stolen line, while still saying "no"
 * on open ground and near a genuine border.
 *
 * CONSEQUENCE WORTH KNOWING: you can only defend land that is roughly 3+ cells
 * thick. A single-cell path you traced across the map is not a homeland and cannot
 * be defended — measured, a 1-wide line never yields a kill while a 3-wide
 * corridor does. That is a deliberate trade-off in favour of the raider: it means
 * territory has to be genuinely held, not merely outlined.
 */
function surroundedBy(
  state: TerritoryState,
  cell: Cell,
  mark: number,
  before: number[],
): boolean {
  let theirs = 0;
  let claimable = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (!inBoundsOf(state.cols, state.rows, x, y)) continue;
      const v = before[idxIn(state.cols, x, y)];
      if (v === WALL) continue;
      claimable++;
      if (v === mark) theirs++;
    }
  }
  return claimable > 0 && theirs * 2 > claimable;
}

/**
 * Kill a player: they stop moving, and come back after the respawn delay at a
 * point chosen NOW so the client can telegraph it.
 *
 * Their territory is untouched. Losing your land on death would make one unlucky
 * bump undo a whole round, and enclosure is meant to be the way ground changes
 * hands.
 */
export function killPlayer(
  state: TerritoryState,
  victimIndex: number,
  killerIndex: number | null,
  rng: () => number = Math.random,
): void {
  const victim = state.players[victimIndex];
  if (!isAlive(victim)) return;
  victim.respawnAtTick = state.tick + state.respawnTicks;
  victim.respawnAt = pickRespawn(state, victimIndex, rng);
  victim.stallTicks = 0;
  victim.queued = [];
  victim.deaths++;
  if (killerIndex !== null && state.players[killerIndex]) {
    state.players[killerIndex].kills++;
  }
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
  if (state.phase === "playing") {
    state.tick++;
    state.ticksLeft = Math.max(0, state.ticksLeft - 1);

    const claimers = new Set<number>();

    // Bring back anyone whose timer has run out, at the point chosen when they
    // died — so where they appear is where the client has been flashing.
    const justRespawned = new Set<number>();
    state.players.forEach((land, i) => {
      if (land.respawnAtTick !== null && state.tick >= land.respawnAtTick) {
        land.at = land.respawnAt ?? pickRespawn(state, i, rng);
        land.respawnAtTick = null;
        land.respawnAt = null;
        land.dir = facingOpen(state, land.at);
        land.queued = [];
        // Skip movement for this one tick, so they actually APPEAR on the square
        // the client has been flashing. Moving in the same tick they return puts
        // them one cell off, which makes the telegraph a lie.
        justRespawned.add(i);
      }
    });

    // Ownership as it stood when the tick began, before anyone's claims land.
    // The kill check judges an exchange against this rather than the live grid.
    const contested = state.grid.slice();
    // Where everyone stood before moving, so a head-on swap can be detected.
    const prev: Record<number, Cell> = {};
    state.players.forEach((land, i) => {
      if (isAlive(land)) prev[i] = { ...land.at };
    });

    state.players.forEach((land, i) => {
      // Dead players don't move, don't claim, and can't be killed again.
      if (!isAlive(land)) return;
      if (justRespawned.has(i)) return;
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
      // CLAIM MODE: enemy land is solid, so a claim really is permanent — the only
      // way to lose ground is being surrounded. RAID MODE lets it change hands.
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

    // ---- defending your ground ----
    //
    // Catch a trespasser standing on land you own and they're killed. Collected
    // then applied, so two players who reach each other on the same tick are
    // resolved together rather than the lower index winning by accident.
    //
    // Only on YOUR OWN ground: this is a defence, not a free-for-all bump. Two
    // players meeting on open ground do nothing to each other.
    // Only in Raid mode. In Claim mode enemy land is impassable, so nobody can be
    // standing on yours to catch in the first place.
    const doomed = new Map<number, number>();
    if (state.raidingAllowed) {
      state.players.forEach((attacker, ai) => {
        if (!isAlive(attacker)) return;
        const mine = ownerOf(ai);
        state.players.forEach((victim, vi) => {
          if (ai === vi || !isAlive(victim)) return;

          // Two ways to catch someone, and the second one is essential.
          //
          // SAME CELL: you moved onto the square they occupy.
          const sameCell = victim.at.x === attacker.at.x && victim.at.y === attacker.at.y;
          // SWAPPED: you passed straight through each other in one tick. Without
          // this a stern chase is unwinnable — everyone moves one cell per tick, so
          // a defender directly behind a raider never closes the gap and killing is
          // effectively impossible. Head-on, the two would otherwise slide past.
          const swapped =
            prev[vi] !== undefined &&
            prev[ai] !== undefined &&
            victim.at.x === prev[ai].x &&
            victim.at.y === prev[ai].y &&
            attacker.at.x === prev[vi].x &&
            attacker.at.y === prev[vi].y;

          if (!sameCell && !swapped) return;

          // WHOSE GROUND IS THIS?
          //
          // Not the single square underfoot. A raider claims each cell as they
          // enter it, so a few ticks into a raid their own trail of stolen squares
          // makes them look like they are standing on their own land — the defender
          // could occupy the very same cell and no kill would register, however
          // closely they chased. Snapshotting one tick earlier doesn't help; the
          // cell changed hands ticks ago.
          //
          // So: is the victim INSIDE the attacker's territory (a majority of
          // neighbours), and NOT inside their own? The second half matters — both
          // players are surrounded by the owner's land during a chase, so a
          // symmetric test killed the defender on home ground, the exact opposite
          // of the rule.
          if (!surroundedBy(state, victim.at, mine, contested)) return;
          if (surroundedBy(state, victim.at, ownerOf(vi), contested)) return;
          doomed.set(vi, ai);
        });
      });
    }
    for (const [vi, ai] of doomed) killPlayer(state, vi, ai, rng);

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
    .map((p) => ({
      userId: p.userId,
      cells: cellsOf(state, p.userId),
      enclosed: p.enclosed,
      kills: p.kills,
      deaths: p.deaths,
    }))
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
