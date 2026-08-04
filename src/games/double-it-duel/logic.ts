/**
 * Double It Duel — multiplayer Double It with a clock that passes around.
 *
 * Everyone starts with the same clock (default 30s). Only the player on turn is
 * ticking down. Answer correctly and your turn ends; the time you just burned,
 * minus the abyss, is split evenly among everyone else. The abyss vanishes.
 *
 *     opponents gain = (time you took − abyss) / (number of other players)
 *
 * That abyss is what makes the game finite: the total time in play strictly
 * decreases on every turn, so however well everyone plays, clocks trend to zero.
 * A slow answer is doubly punishing — you lose the time AND hand most of it to
 * everyone else.
 *
 * Clocks may exceed the starting amount. Overflow is deliberate: answering fast
 * while others dawdle should bank a real cushion, and capping it would remove
 * the reward for being quick.
 *
 * Run out of time, or answer wrong, and you're out. Last player standing wins.
 *
 * Pure rules — no DOM, no sockets, no timers. The server owns the wall clock and
 * calls into here; see ./server.js.
 */

import { MULTIPLIERS, type Multiplier } from "../double-it/logic";

export { MULTIPLIERS, type Multiplier };

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 10_000;

/** Host-configurable, with the ranges the server clamps to. */
export interface DuelSettings {
  multiplier: Multiplier;
  /** Seconds each player starts with. */
  startSeconds: number;
  /**
   * Seconds swallowed by the abyss on each turn — never passed on to anyone.
   * Must stay above zero or the game can run forever.
   */
  abyssSeconds: number;
}

export const SETTING_LIMITS = {
  startSeconds: { min: 5, max: 180, step: 5 },
  // A floor of 0.25s keeps termination guaranteed while still allowing a long,
  // grindy game for people who want one.
  abyssSeconds: { min: 0.25, max: 10, step: 0.25 },
} as const;

export const DEFAULT_SETTINGS: DuelSettings = {
  multiplier: 2,
  startSeconds: 30,
  abyssSeconds: 1,
};

/**
 * Backstop on turn count. The abyss guarantees termination mathematically, but
 * with many players all answering in a fraction of a second the drain per turn
 * is tiny, so a game could outlast anyone's patience. Whoever has the most time
 * banked when this trips takes it.
 */
export const MAX_TURNS = 500;

export type DuelPhase = "lobby" | "playing" | "over";

export interface DuelPlayer {
  userId: string;
  /** Seconds remaining. May exceed settings.startSeconds — overflow is allowed. */
  clock: number;
  alive: boolean;
  /** Correct answers given. The tiebreaker if the turn cap is reached. */
  solved: number;
  eliminatedBy?: "time" | "wrong";
}

export interface DuelState {
  phase: DuelPhase;
  settings: DuelSettings;
  players: DuelPlayer[];
  /** Index into `players` of whoever is on turn. */
  turnIndex: number;
  /** The number to multiply, for the current turn. */
  prompt: number;
  /** Turns completed, against MAX_TURNS. */
  turns: number;
  winner: string | null;
  /** Set for one broadcast after a turn resolves, so clients can narrate it. */
  lastTurn: {
    userId: string;
    took: number;
    gaveEach: number;
    correct: boolean;
  } | null;
  /** Wins per player across the session, so a rematch keeps a tally. */
  wins: Record<string, number>;
}

export function randomPrompt(rng: () => number = Math.random): number {
  return MIN_NUMBER + Math.floor(rng() * (MAX_NUMBER - MIN_NUMBER + 1));
}

export function clampSettings(partial: Partial<DuelSettings>, base = DEFAULT_SETTINGS): DuelSettings {
  const out: DuelSettings = { ...base };

  if (
    typeof partial.multiplier === "number" &&
    (MULTIPLIERS as readonly number[]).includes(partial.multiplier)
  ) {
    out.multiplier = partial.multiplier as Multiplier;
  }
  if (typeof partial.startSeconds === "number" && Number.isFinite(partial.startSeconds)) {
    const { min, max } = SETTING_LIMITS.startSeconds;
    out.startSeconds = Math.min(max, Math.max(min, Math.round(partial.startSeconds)));
  }
  if (typeof partial.abyssSeconds === "number" && Number.isFinite(partial.abyssSeconds)) {
    const { min, max } = SETTING_LIMITS.abyssSeconds;
    // Quarter-second granularity; the floor is what keeps the game finite.
    const snapped = Math.round(partial.abyssSeconds * 4) / 4;
    out.abyssSeconds = Math.min(max, Math.max(min, snapped));
  }
  return out;
}

export function createDuel(
  userIds: string[],
  settings: DuelSettings = DEFAULT_SETTINGS,
  rng: () => number = Math.random,
  wins: Record<string, number> = {},
): DuelState {
  return {
    phase: "lobby",
    settings,
    players: userIds.map((userId) => ({
      userId,
      clock: settings.startSeconds,
      alive: true,
      solved: 0,
    })),
    turnIndex: 0,
    prompt: randomPrompt(rng),
    turns: 0,
    winner: null,
    lastTurn: null,
    wins,
  };
}

export function start(state: DuelState, rng: () => number = Math.random): DuelState {
  if (state.phase !== "lobby") return state;
  if (state.players.filter((p) => p.alive).length < 2) return state;
  return {
    ...state,
    phase: "playing",
    prompt: randomPrompt(rng),
    turnIndex: firstAliveFrom(state.players, 0),
    lastTurn: null,
  };
}

export function currentPlayer(state: DuelState): DuelPlayer | null {
  return state.players[state.turnIndex] ?? null;
}

export function target(state: DuelState): number {
  return state.prompt * state.settings.multiplier;
}

function firstAliveFrom(players: DuelPlayer[], from: number): number {
  for (let i = 0; i < players.length; i++) {
    const idx = (from + i) % players.length;
    if (players[idx].alive) return idx;
  }
  return 0;
}

/** Next living player after the current one. */
export function nextTurnIndex(players: DuelPlayer[], current: number): number {
  return firstAliveFrom(players, (current + 1) % players.length);
}

/**
 * Resolve a turn.
 *
 * `elapsed` is measured by the server, never sent by the client — a client that
 * reported its own thinking time could simply claim zero.
 */
export function resolveTurn(
  state: DuelState,
  userId: string,
  answer: number,
  elapsed: number,
  rng: () => number = Math.random,
): DuelState {
  if (state.phase !== "playing") return state;
  const actor = currentPlayer(state);
  // Ignore anyone answering out of turn; only the player on clock may act.
  if (!actor || actor.userId !== userId || !actor.alive) return state;

  const took = Math.max(0, elapsed);
  const correct = answer === target(state);

  // The clock keeps running while you think, so it always costs you the time.
  let players = state.players.map((p) =>
    p.userId === userId ? { ...p, clock: p.clock - took } : p,
  );

  const me = players.find((p) => p.userId === userId)!;
  const ranOut = me.clock <= 0;

  if (!correct || ranOut) {
    players = players.map((p) =>
      p.userId === userId
        ? {
            ...p,
            alive: false,
            clock: Math.max(0, p.clock),
            eliminatedBy: ranOut ? "time" : "wrong",
          }
        : p,
    );
    return finish(
      {
        ...state,
        players,
        turns: state.turns + 1,
        lastTurn: { userId, took, gaveEach: 0, correct },
      },
      rng,
    );
  }

  // Correct: hand out (took − abyss), split among the other living players.
  const others = players.filter((p) => p.alive && p.userId !== userId);
  const pot = Math.max(0, took - state.settings.abyssSeconds);
  const gaveEach = others.length > 0 ? pot / others.length : 0;

  players = players.map((p) => {
    if (p.userId === userId) return { ...p, solved: p.solved + 1 };
    if (!p.alive) return p;
    // No cap — overflowing past startSeconds is the reward for being fast.
    return { ...p, clock: p.clock + gaveEach };
  });

  return finish(
    {
      ...state,
      players,
      turns: state.turns + 1,
      prompt: randomPrompt(rng),
      turnIndex: nextTurnIndex(players, state.turnIndex),
      lastTurn: { userId, took, gaveEach, correct: true },
    },
    rng,
  );
}

/**
 * Clock ran out with no answer. Separate from resolveTurn because there is no
 * answer to judge and nothing to pass on — the whole remaining clock is spent.
 */
export function timeOut(state: DuelState, userId: string, rng: () => number = Math.random): DuelState {
  if (state.phase !== "playing") return state;
  const actor = currentPlayer(state);
  if (!actor || actor.userId !== userId) return state;

  const players = state.players.map((p) =>
    p.userId === userId ? { ...p, clock: 0, alive: false, eliminatedBy: "time" as const } : p,
  );
  return finish(
    {
      ...state,
      players,
      turns: state.turns + 1,
      lastTurn: { userId, took: actor.clock, gaveEach: 0, correct: false },
    },
    rng,
  );
}

/** A player leaving mid-game forfeits rather than stalling everyone else. */
export function forfeit(state: DuelState, userId: string, rng: () => number = Math.random): DuelState {
  if (state.phase !== "playing") return state;
  const target = state.players.find((p) => p.userId === userId);
  if (!target || !target.alive) return state;

  const wasTheirTurn = currentPlayer(state)?.userId === userId;
  const players = state.players.map((p) =>
    p.userId === userId ? { ...p, alive: false, clock: 0, eliminatedBy: "time" as const } : p,
  );
  const next = {
    ...state,
    players,
    // Only advance the turn if we just removed whoever was holding it.
    turnIndex: wasTheirTurn ? nextTurnIndex(players, state.turnIndex) : state.turnIndex,
    prompt: wasTheirTurn ? randomPrompt(rng) : state.prompt,
  };
  return finish(next, rng);
}

/** Decide whether the duel is over, and settle the turn index if not. */
function finish(state: DuelState, rng: () => number): DuelState {
  const alive = state.players.filter((p) => p.alive);

  if (alive.length === 1) {
    return {
      ...state,
      phase: "over",
      winner: alive[0].userId,
      wins: bumpWins(state.wins, alive[0].userId),
    };
  }
  if (alive.length === 0) {
    // Everyone out on the same turn — nobody takes it.
    return { ...state, phase: "over", winner: null };
  }

  if (state.turns >= MAX_TURNS) {
    // Most time banked wins; ties on clock fall to most solved, then a draw.
    const best = Math.max(...alive.map((p) => p.clock));
    let leaders = alive.filter((p) => p.clock === best);
    if (leaders.length > 1) {
      const bestSolved = Math.max(...leaders.map((p) => p.solved));
      leaders = leaders.filter((p) => p.solved === bestSolved);
    }
    const winner = leaders.length === 1 ? leaders[0].userId : null;
    return { ...state, phase: "over", winner, wins: bumpWins(state.wins, winner) };
  }

  // Make sure the turn hasn't landed on someone who just went out.
  const holder = state.players[state.turnIndex];
  if (!holder || !holder.alive) {
    return { ...state, turnIndex: nextTurnIndex(state.players, state.turnIndex), prompt: randomPrompt(rng) };
  }
  return state;
}

function bumpWins(wins: Record<string, number>, winner: string | null): Record<string, number> {
  if (!winner) return wins;
  return { ...wins, [winner]: (wins[winner] ?? 0) + 1 };
}

/** Total time still in play — strictly decreasing, which is why this ends. */
export function timeInPlay(state: DuelState): number {
  return state.players.reduce((sum, p) => sum + (p.alive ? Math.max(0, p.clock) : 0), 0);
}
