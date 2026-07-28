/**
 * Pure Snake rules — no DOM, no React, so it can be unit tested directly.
 * Supports Classic Mode and Maze Mode.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Dir {
  x: number;
  y: number;
}

export type GameMode = "classic" | "maze";

export const COLS = 20;
export const ROWS = 20;
export const TICK_MS = 120;

export const MAZE_COLS = 35;
export const MAZE_ROWS = 35;
export const MAZE_INITIAL_TICK_MS = 180;
export const MAZE_MIN_TICK_MS = 70;
const NO_FOOD: Cell = { x: -1, y: -1 };

export interface SnakeState {
  mode: GameMode;
  cols: number;
  rows: number;
  snake: Cell[];
  dir: Dir;
  /** Buffered turns, applied one per tick (see applyTurn). */
  queued: Dir[];
  food: Cell;
  score: number;
  dead: boolean;

  // Maze mode specific properties:
  level: number;
  walls: boolean[][]; // walls[y][x] === true if wall
  exit: Cell;
  exitOpen: boolean;
  tickMs: number;
  wonRound: boolean;
}

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

/** Generate a 2D grid matrix of maze walls using recursive backtracking. */
export function generateMaze(
  cols: number,
  rows: number,
  rng: () => number = Math.random,
  corridorWidth = 1,
): boolean[][] {
  if (corridorWidth > 1) {
    return generateWideMaze(cols, rows, corridorWidth, rng);
  }

  const width = cols % 2 === 0 ? cols + 1 : cols;
  const height = rows % 2 === 0 ? rows + 1 : rows;

  const walls: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(true)
  );
  const visited: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(false)
  );

  const stack: { x: number; y: number }[] = [];

  const startX = 1;
  const startY = 1;
  walls[startY][startX] = false;
  visited[startY][startX] = true;
  stack.push({ x: startX, y: startY });

  const dirs = [
    { x: 0, y: -2 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors: { x: number; y: number; wx: number; wy: number }[] = [];

    for (const d of dirs) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && !visited[ny][nx]) {
        neighbors.push({
          x: nx,
          y: ny,
          wx: current.x + d.x / 2,
          wy: current.y + d.y / 2,
        });
      }
    }

    if (neighbors.length > 0) {
      const nextIndex = Math.floor(rng() * neighbors.length);
      const next = neighbors[nextIndex];
      walls[next.wy][next.wx] = false;
      walls[next.y][next.x] = false;
      visited[next.y][next.x] = true;
      stack.push({ x: next.x, y: next.y });
    } else {
      stack.pop();
    }
  }

  // Knock down a few inner wall segments (5% chance) for extra paths/braiding
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      if (walls[y][x] && rng() < 0.05) {
        walls[y][x] = false;
      }
    }
  }

  return walls;
}

/**
 * Generate a maze whose passages occupy 2 or 3 cells. The logical maze uses
 * one-cell walls between wide rooms, keeping the map readable while leaving
 * enough room for Snake to turn around.
 */
function generateWideMaze(
  cols: number,
  rows: number,
  corridorWidth: number,
  rng: () => number,
): boolean[][] {
  const width = cols % 2 === 0 ? cols + 1 : cols;
  const height = rows % 2 === 0 ? rows + 1 : rows;
  const walls: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(true),
  );
  // Generate a normal dense maze first, then scale each cell into a square
  // passage. This preserves the wall structure instead of filling the board.
  let baseSize = Math.floor((width - 2) / corridorWidth) + 1;
  if (baseSize % 2 === 0) baseSize -= 1;
  const base = generateMaze(baseSize, baseSize, rng);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Keep the generator's one-cell outer border intact while mapping the
      // playable start cell (1,1) to the generator's open cell (1,1).
      const baseX = Math.min(1 + Math.floor((x - 1) / corridorWidth), baseSize - 1);
      const baseY = Math.min(1 + Math.floor((y - 1) / corridorWidth), baseSize - 1);
      walls[y][x] = base[baseY][baseX];
    }
  }

  // The scaled odd-sized maze may stop at (31,31); always make the finish at
  // (33,33) reachable through a short final corridor.
  const last = 1 + (baseSize - 2) * corridorWidth;
  for (let x = Math.min(last, width - 2); x <= width - 2; x++) walls[last][x] = false;
  for (let y = Math.min(last, height - 2); y <= height - 2; y++) walls[y][width - 2] = false;
  return walls;
}

/** Deterministic food placement so tests can inject their own RNG. */
export function placeFood(snake: Cell[], rng: () => number = Math.random): Cell {
  return placeFoodOnBoard(snake, COLS, ROWS, undefined, rng);
}

function placeFoodOnBoard(
  snake: Cell[],
  cols: number,
  rows: number,
  walls: boolean[][] | undefined,
  rng: () => number,
): Cell {
  const free: Cell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (walls && walls[y] && walls[y][x]) continue; // Skip wall cells
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  // Board full — fallback
  if (free.length === 0) return snake[0];
  return free[Math.floor(rng() * free.length)];
}

export function getTickMsForLevel(level: number): number {
  return Math.max(MAZE_MIN_TICK_MS, MAZE_INITIAL_TICK_MS - (level - 1) * 8);
}

export function getMazeCorridorWidth(level: number): 2 | 3 {
  return level <= 2 ? 3 : 2;
}

export function createGame(rng?: () => number): SnakeState;
export function createGame(
  mode?: GameMode,
  level?: number,
  currentScore?: number,
  rng?: () => number,
): SnakeState;
export function createGame(
  modeOrRng: GameMode | (() => number) = "classic",
  level: number = 1,
  currentScore: number = 0,
  rng: () => number = Math.random
): SnakeState {
  const mode = typeof modeOrRng === "function" ? "classic" : modeOrRng;
  const random = typeof modeOrRng === "function" ? modeOrRng : rng;

  if (mode === "maze") {
    const cols = MAZE_COLS;
    const rows = MAZE_ROWS;
    const walls = generateMaze(cols, rows, random, getMazeCorridorWidth(level));
    const exit = { x: cols - 2, y: rows - 2 };

    const snake: Cell[] = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ];

    const tickMs = getTickMsForLevel(level);

    return {
      mode,
      cols,
      rows,
      snake,
      dir: DIRS.right,
      queued: [],
      // Maze Mode is a navigation challenge: only the exit scores a round.
      food: NO_FOOD,
      score: currentScore,
      dead: false,
      level,
      walls,
      exit,
      exitOpen: true,
      tickMs,
      wonRound: false,
    };
  }

  // Classic mode
  const snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  return {
    mode: "classic",
    cols: COLS,
    rows: ROWS,
    snake,
    dir: DIRS.right,
    queued: [],
    food: placeFood(snake, random),
    score: currentScore,
    dead: false,
    level: 1,
    walls: Array.from({ length: ROWS }, () => Array(COLS).fill(false)),
    exit: { x: -1, y: -1 },
    exitOpen: false,
    tickMs: TICK_MS,
    wonRound: false,
  };
}

/**
 * Queue a turn. Buffering rather than applying immediately is what stops two
 * fast keypresses inside one tick from folding the snake back on itself.
 */
export function queueTurn(state: SnakeState, dir: Dir): SnakeState {
  if (state.dead || state.wonRound) return state;
  // Cap the buffer so mashing keys can't build a long backlog of stale turns.
  if (state.queued.length >= 2) return state;
  return { ...state, queued: [...state.queued, dir] };
}

function nextDir(state: SnakeState): { dir: Dir; queued: Dir[] } {
  const queued = [...state.queued];
  let dir = state.dir;
  while (queued.length) {
    const nd = queued.shift()!;
    // Reject 180° reversals; they'd instantly collide with the neck.
    if (nd.x + dir.x !== 0 || nd.y + dir.y !== 0) {
      dir = nd;
      break;
    }
  }
  return { dir, queued };
}

export function step(state: SnakeState, rng: () => number = Math.random): SnakeState {
  if (state.dead || state.wonRound) return state;

  const { dir, queued } = nextDir(state);
  const head = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };

  const hitBounds =
    head.x < 0 || head.x >= state.cols || head.y < 0 || head.y >= state.rows;
  const hitWall =
    !hitBounds && state.walls[head.y] && state.walls[head.y][head.x] === true;

  const eating =
    state.mode === "classic" &&
    head.x === state.food.x &&
    head.y === state.food.y;
  const reachedExit =
    state.mode === "maze" &&
    state.exitOpen &&
    head.x === state.exit.x &&
    head.y === state.exit.y;

  // The tail tip vacates this tick, so moving into it is legal — unless we're
  // growing, in which case the tail stays put.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  const hitSelf = body.some((s) => s.x === head.x && s.y === head.y);

  if (hitBounds || hitWall || hitSelf) {
    return { ...state, dir, queued, dead: true };
  }

  // Handle round win in Maze Mode when reaching the Exit Portal
  if (reachedExit) {
    const levelBonus = 50 * state.level;
    return {
      ...state,
      snake: [head, ...state.snake.slice(0, -1)],
      dir,
      queued,
      score: state.score + levelBonus,
      wonRound: true,
    };
  }

  const snake = [head, ...(eating ? state.snake : state.snake.slice(0, -1))];
  return {
    ...state,
    snake,
    dir,
    queued,
    food: eating ? placeFoodOnBoard(snake, state.cols, state.rows, state.walls, rng) : state.food,
    score: eating ? state.score + 1 : state.score,
    dead: false,
  };
}

/** Advance to the next round in Maze mode after winning a round. */
export function advanceLevel(
  state: SnakeState,
  rng: () => number = Math.random
): SnakeState {
  if (state.mode !== "maze") return state;
  const nextLevel = state.level + 1;
  return createGame("maze", nextLevel, state.score, rng);
}
