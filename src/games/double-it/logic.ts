/** Pure rules for Double It! — no DOM, no React. */

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 10_000;
export const START_MS = 10_000;
/** Each cleared round shaves this much off the clock (10s, 9.9s, 9.8s, ...). */
export const STEP_MS = 100;
/** Floor so the game stays theoretically playable rather than impossible. */
export const MIN_MS = 1_500;

/**
 * Selectable multipliers. The name stays "Double It!", but you can play ×2
 * through ×9 — each is its own mode with its own leaderboard, because ×9 of a
 * four-digit number under a shrinking clock is a completely different game from
 * ×2 and a shared board would be meaningless.
 */
export const MULTIPLIERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];
export const DEFAULT_MULTIPLIER: Multiplier = 2;

export function isMultiplier(n: number): n is Multiplier {
  return (MULTIPLIERS as readonly number[]).includes(n);
}

export interface DoubleItState {
  round: number;
  prompt: number;
  /** What to multiply the prompt by this run. Fixed for the whole run. */
  multiplier: Multiplier;
  /** Time allowed for the current round. */
  allowedMs: number;
  status: "playing" | "lost";
  /** Why the run ended — drives the end-of-game message. */
  lostTo?: "time" | "wrong";
  lastAnswer?: number;
}

export function allowedMsForRound(round: number): number {
  return Math.max(MIN_MS, START_MS - (round - 1) * STEP_MS);
}

export function randomPrompt(rng: () => number = Math.random): number {
  return MIN_NUMBER + Math.floor(rng() * (MAX_NUMBER - MIN_NUMBER + 1));
}

export function createGame(
  multiplier: Multiplier = DEFAULT_MULTIPLIER,
  rng: () => number = Math.random,
): DoubleItState {
  return {
    round: 1,
    prompt: randomPrompt(rng),
    multiplier,
    allowedMs: allowedMsForRound(1),
    status: "playing",
  };
}

/** The number the player must type this round. */
export function target(state: DoubleItState): number {
  return state.prompt * state.multiplier;
}

export function isCorrect(prompt: number, multiplier: Multiplier, answer: number): boolean {
  return answer === prompt * multiplier;
}

/** Submitting an answer: either advance a round or end the run. */
export function submit(
  state: DoubleItState,
  answer: number,
  rng: () => number = Math.random,
): DoubleItState {
  if (state.status !== "playing") return state;

  if (!isCorrect(state.prompt, state.multiplier, answer)) {
    return { ...state, status: "lost", lostTo: "wrong", lastAnswer: answer };
  }

  const round = state.round + 1;
  return {
    round,
    prompt: randomPrompt(rng),
    multiplier: state.multiplier,
    allowedMs: allowedMsForRound(round),
    status: "playing",
  };
}

export function timeOut(state: DoubleItState): DoubleItState {
  if (state.status !== "playing") return state;
  return { ...state, status: "lost", lostTo: "time" };
}

/** Rounds fully cleared — round 1 in progress means a score of 0. */
export function score(state: DoubleItState): number {
  return state.round - 1;
}

/** localStorage / leaderboard key for a mode. Base slug is plain "double-it". */
export function boardSlug(multiplier: Multiplier): string {
  return `double-it:${multiplier}x`;
}
