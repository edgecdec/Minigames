/** Pure rules for Let's Get High — exact integer arithmetic, no DOM or React. */

export interface LetsGetHighState {
  status: "waiting" | "playing" | "lost";
  current: bigint;
  rounds: number;
  lastAnswer?: bigint;
  milestone?: string;
}

export function createGame(): LetsGetHighState {
  return { status: "waiting", current: BigInt(0), rounds: 0 };
}

export function startGame(answer: bigint, rng: () => number = Math.random): LetsGetHighState {
  return { status: "playing", current: randomHigher(answer, rng), rounds: 0, lastAnswer: answer, milestone: milestoneFor(answer) };
}

/** Produces a playful, unpredictable raise while always staying exact and higher. */
export function randomHigher(current: bigint, rng: () => number = Math.random): bigint {
  const digits = current.toString().length;
  const scale = BigInt(10) ** BigInt(Math.max(0, digits - 1));
  const raise = BigInt(1 + Math.floor(rng() * 900)) * scale;
  return current + raise;
}

export function milestoneFor(value: bigint): string | undefined {
  const digits = value.toString().length;
  if (digits >= 100) return "A HUNDRED DIGITS?! Bob has left the atmosphere!";
  if (digits >= 50) return "Fifty digits! Bob is now legally a speck of stardust.";
  if (digits >= 25) return "Twenty-five digits! The number has its own zip code.";
  if (value >= BigInt("1000000000")) return "A billion! Bob respectfully removes his hat.";
  if (value >= BigInt("1000000")) return "One million! Bob has hired an accountant.";
  if (value >= BigInt("1000")) return "One thousand! Tiny comma, enormous confidence.";
  return undefined;
}

export function submit(
  state: LetsGetHighState,
  answer: bigint,
  rng: () => number = Math.random,
): LetsGetHighState {
  if (state.status === "waiting") return startGame(answer, rng);
  if (state.status === "lost") return state;
  if (answer <= state.current) return { ...state, status: "lost", lastAnswer: answer };
  return {
    status: "playing",
    current: randomHigher(answer, rng),
    rounds: state.rounds + 1,
    lastAnswer: answer,
    milestone: milestoneFor(answer),
  };
}

export function score(state: LetsGetHighState): number {
  return state.rounds;
}
