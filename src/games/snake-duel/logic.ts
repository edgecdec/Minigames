/**
 * Snake 1v1 — pure rules, no DOM, no sockets.
 *
 * From the Discord thread (Alukian): "a variant of slither.io where it's locked
 * to a grid like Snake. Or add 1v1 battles."
 *
 * Server-authoritative: the server owns the tick and the collision test, and
 * clients only send a desired direction. That is the whole point of a duel —
 * a client that decided its own outcome could simply declare itself the winner.
 *
 * Deliberately simultaneous rather than turn-based, so both snakes move on the
 * same tick and a head-on crash is a draw rather than whoever's packet arrived
 * first.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Dir {
  x: number;
  y: number;
}

export const COLS = 24;
export const ROWS = 24;
/** Slower than solo Snake: shared latency makes 120ms feel unfair. */
export const TICK_MS = 160;
/** Food on the board at once. More than one keeps players from queueing up. */
export const FOOD_COUNT = 3;
/** A duel that neither player can finish shouldn't run forever. */
export const MAX_TICKS = 3_000;

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

export interface DuelSnake {
  userId: string;
  body: Cell[];
  dir: Dir;
  /** Buffered turns, one applied per tick — same anti-fold rule as solo Snake. */
  queued: Dir[];
  alive: boolean;
  score: number;
  /** Why they died, for the result screen. */
  causeOfDeath: "wall" | "self" | "opponent" | "head-on" | null;
}

export type DuelPhase = "waiting" | "countdown" | "playing" | "over";

export interface DuelState {
  phase: DuelPhase;
  snakes: DuelSnake[];
  food: Cell[];
  tick: number;
  /** userId of the winner, or null for a draw. Only set when phase is "over". */
  winner: string | null;
  /** Ticks remaining before play begins. */
  countdown: number;
  /** Wins per player across the session, so a rematch keeps a running tally. */
  wins: Record<string, number>;
}

/** Opposite corners, heading away from their own wall. */
const SPAWNS: { at: Cell; dir: Dir }[] = [
  { at: { x: 3, y: 3 }, dir: DIRS.right },
  { at: { x: COLS - 4, y: ROWS - 4 }, dir: DIRS.left },
];

function spawnSnake(userId: string, index: number): DuelSnake {
  const spawn = SPAWNS[index % SPAWNS.length];
  // Body trails behind the head so the snake isn't instantly self-colliding.
  const body: Cell[] = [0, 1, 2].map((i) => ({
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

export function occupied(state: DuelState): Cell[] {
  return state.snakes.flatMap((s) => s.body);
}

export function placeFood(
  taken: Cell[],
  count: number,
  rng: () => number = Math.random,
): Cell[] {
  const free: Cell[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!taken.some((c) => c.x === x && c.y === y)) free.push({ x, y });
    }
  }
  const out: Cell[] = [];
  for (let i = 0; i < count && free.length > 0; i++) {
    const idx = Math.floor(rng() * free.length);
    out.push(free.splice(idx, 1)[0]);
  }
  return out;
}

export function createDuel(
  userIds: string[],
  rng: () => number = Math.random,
  wins: Record<string, number> = {},
): DuelState {
  const snakes = userIds.slice(0, 2).map((id, i) => spawnSnake(id, i));
  const state: DuelState = {
    phase: userIds.length < 2 ? "waiting" : "countdown",
    snakes,
    food: [],
    tick: 0,
    winner: null,
    countdown: 3,
    wins,
  };
  state.food = placeFood(occupied(state), FOOD_COUNT, rng);
  return state;
}

export function queueTurn(state: DuelState, userId: string, dir: Dir): DuelState {
  if (state.phase !== "playing" && state.phase !== "countdown") return state;
  return {
    ...state,
    snakes: state.snakes.map((s) => {
      if (s.userId !== userId || !s.alive) return s;
      // Cap the buffer so mashing keys can't bank a queue of stale turns.
      if (s.queued.length >= 2) return s;
      return { ...s, queued: [...s.queued, dir] };
    }),
  };
}

function nextDir(snake: DuelSnake): { dir: Dir; queued: Dir[] } {
  const queued = [...snake.queued];
  let dir = snake.dir;
  while (queued.length) {
    const nd = queued.shift()!;
    // Reject 180° reversals — they'd collide with your own neck instantly.
    if (nd.x + dir.x !== 0 || nd.y + dir.y !== 0) {
      dir = nd;
      break;
    }
  }
  return { dir, queued };
}

function samePos(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Advance one tick.
 *
 * Both snakes move simultaneously, which is what makes the collision order
 * matter: every new head is computed first, then all of them are judged against
 * the same before-and-after board. Moving one snake fully and then the other
 * would hand the first-moved player an advantage.
 */
export function step(state: DuelState, rng: () => number = Math.random): DuelState {
  if (state.phase === "countdown") {
    const countdown = state.countdown - 1;
    return countdown <= 0
      ? { ...state, phase: "playing", countdown: 0 }
      : { ...state, countdown };
  }
  if (state.phase !== "playing") return state;

  const dirs = state.snakes.map((s) => (s.alive ? nextDir(s) : { dir: s.dir, queued: s.queued }));
  const heads = state.snakes.map((s, i) =>
    s.alive ? { x: s.body[0].x + dirs[i].dir.x, y: s.body[0].y + dirs[i].dir.y } : s.body[0],
  );

  const eats = state.snakes.map(
    (s, i) => s.alive && state.food.some((f) => samePos(f, heads[i])),
  );

  // Bodies as they will be AFTER this tick's tail movement. A tail tip vacates
  // the cell it occupied unless that snake is growing.
  const futureBodies = state.snakes.map((s, i) => {
    if (!s.alive) return s.body;
    return eats[i] ? s.body : s.body.slice(0, -1);
  });

  const deaths: (DuelSnake["causeOfDeath"] | null)[] = state.snakes.map(() => null);

  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const head = heads[i];

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      deaths[i] = "wall";
      return;
    }
    // Head-on: both heads target the same cell. Mutual, so it's a draw.
    for (let j = 0; j < state.snakes.length; j++) {
      if (j === i || !state.snakes[j].alive) continue;
      if (samePos(head, heads[j])) {
        deaths[i] = "head-on";
        return;
      }
    }
    if (futureBodies[i].some((c) => samePos(c, head))) {
      deaths[i] = "self";
      return;
    }
    for (let j = 0; j < state.snakes.length; j++) {
      if (j === i) continue;
      if (futureBodies[j].some((c) => samePos(c, head))) {
        deaths[i] = "opponent";
        return;
      }
    }
  });

  let food = state.food.filter(
    (f) => !heads.some((h, i) => state.snakes[i].alive && samePos(f, h)),
  );

  const snakes = state.snakes.map((s, i) => {
    if (!s.alive) return s;
    if (deaths[i]) {
      return { ...s, dir: dirs[i].dir, queued: dirs[i].queued, alive: false, causeOfDeath: deaths[i] };
    }
    return {
      ...s,
      body: [heads[i], ...futureBodies[i]],
      dir: dirs[i].dir,
      queued: dirs[i].queued,
      score: eats[i] ? s.score + 1 : s.score,
    };
  });

  const next: DuelState = { ...state, snakes, food, tick: state.tick + 1 };

  // Top the board back up so there's always something to chase.
  if (food.length < FOOD_COUNT) {
    const taken = occupied(next);
    food = [...food, ...placeFood([...taken, ...food], FOOD_COUNT - food.length, rng)];
    next.food = food;
  }

  return resolveOutcome(next);
}

/** Decide whether the duel has ended, and who won. */
export function resolveOutcome(state: DuelState): DuelState {
  const alive = state.snakes.filter((s) => s.alive);

  if (alive.length > 1) {
    // A stalemate cap so a duel can't run forever; longest snake takes it.
    if (state.tick >= MAX_TICKS) {
      const best = Math.max(...state.snakes.map((s) => s.score));
      const leaders = state.snakes.filter((s) => s.score === best);
      const winner = leaders.length === 1 ? leaders[0].userId : null;
      return { ...state, phase: "over", winner, wins: bumpWins(state.wins, winner) };
    }
    return state;
  }

  if (alive.length === 1) {
    const winner = alive[0].userId;
    return { ...state, phase: "over", winner, wins: bumpWins(state.wins, winner) };
  }

  // Nobody left — simultaneous death is a draw.
  return { ...state, phase: "over", winner: null, wins: state.wins };
}

function bumpWins(wins: Record<string, number>, winner: string | null): Record<string, number> {
  if (!winner) return wins;
  return { ...wins, [winner]: (wins[winner] ?? 0) + 1 };
}

/** Score credited to the global leaderboard: food eaten, +5 for the win. */
export function duelScore(state: DuelState, userId: string): number {
  const snake = state.snakes.find((s) => s.userId === userId);
  if (!snake) return 0;
  return snake.score + (state.winner === userId ? 5 : 0);
}
