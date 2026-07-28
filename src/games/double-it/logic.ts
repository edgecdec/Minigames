/** Pure rules for Double It! — no DOM, no React. */

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 10_000;
export const START_MS = 10_000;
/** Each cleared round shaves this much off the clock (10s, 9.9s, 9.8s, ...). */
export const STEP_MS = 100;
/** Floor so the game stays theoretically playable rather than impossible. */
export const MIN_MS = 1_500;

export interface DoubleItState {
  round: number;
  prompt: number;
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

export function createGame(rng: () => number = Math.random): DoubleItState {
  return {
    round: 1,
    prompt: randomPrompt(rng),
    allowedMs: allowedMsForRound(1),
    status: "playing",
  };
}

export function isCorrect(prompt: number, answer: number): boolean {
  return answer === prompt * 2;
}

/** Submitting an answer: either advance a round or end the run. */
export function submit(
  state: DoubleItState,
  answer: number,
  rng: () => number = Math.random,
): DoubleItState {
  if (state.status !== "playing") return state;

  if (!isCorrect(state.prompt, answer)) {
    return { ...state, status: "lost", lostTo: "wrong", lastAnswer: answer };
  }

  const round = state.round + 1;
  return {
    round,
    prompt: randomPrompt(rng),
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
