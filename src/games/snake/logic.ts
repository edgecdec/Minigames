/**
 * Pure Snake rules — no DOM, no React, so it can be unit tested directly.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Dir {
  x: number;
  y: number;
}

export const COLS = 20;
export const ROWS = 20;
export const TICK_MS = 120;

export interface SnakeState {
  snake: Cell[];
  dir: Dir;
  /** Buffered turns, applied one per tick (see applyTurn). */
  queued: Dir[];
  food: Cell;
  score: number;
  dead: boolean;
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

/** Deterministic food placement so tests can inject their own RNG. */
export function placeFood(snake: Cell[], rng: () => number = Math.random): Cell {
  const free: Cell[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  // Board full — the player has won; caller treats this as a win state.
  if (free.length === 0) return snake[0];
  return free[Math.floor(rng() * free.length)];
}

export function createGame(rng: () => number = Math.random): SnakeState {
  const snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  return {
    snake,
    dir: DIRS.right,
    queued: [],
    food: placeFood(snake, rng),
    score: 0,
    dead: false,
  };
}

/**
 * Queue a turn. Buffering rather than applying immediately is what stops two
 * fast keypresses inside one tick from folding the snake back on itself.
 */
export function queueTurn(state: SnakeState, dir: Dir): SnakeState {
  if (state.dead) return state;
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
  if (state.dead) return state;

  const { dir, queued } = nextDir(state);
  const head = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };

  const hitWall = head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
  const eating = head.x === state.food.x && head.y === state.food.y;
  // The tail tip vacates this tick, so moving into it is legal — unless we're
  // growing, in which case the tail stays put.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  const hitSelf = body.some((s) => s.x === head.x && s.y === head.y);

  if (hitWall || hitSelf) return { ...state, dir, queued, dead: true };

  const snake = [head, ...(eating ? state.snake : state.snake.slice(0, -1))];
  return {
    snake,
    dir,
    queued,
    food: eating ? placeFood(snake, rng) : state.food,
    score: eating ? state.score + 1 : state.score,
    dead: false,
  };
}
