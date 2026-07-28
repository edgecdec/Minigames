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

/** Raises the player's number by a random 1%–100%, always rounding up. */
export function randomHigher(current: bigint, rng: () => number = Math.random): bigint {
  const percent = BigInt(1 + Math.floor(rng() * 100));
  const numerator = current * (BigInt(100) + percent);
  const base = (numerator + BigInt(99)) / BigInt(100);

  // Replace the last few digits with an independent random suffix. This keeps
  // Lilian's number in the selected percentage range without echoing endings.
  const suffixDigits = Math.min(3, base.toString().length);
  const modulus = BigInt(10) ** BigInt(suffixDigits);
  const prefix = base / modulus;
  let result = prefix * modulus + BigInt(Math.floor(rng() * Number(modulus)));
  if (result <= current) result += modulus;
  if (result > current * BigInt(2)) return base;
  return result;
}

export function milestoneFor(value: bigint): string | undefined {
  const digits = value.toString().length;
  if (digits >= 100) return "A HUNDRED DIGITS?! Lilian has left the atmosphere!";
  if (digits >= 50) return "Fifty digits! Lilian is now legally a speck of stardust.";
  if (digits >= 25) return "Twenty-five digits! The number has its own zip code.";
  if (value >= BigInt("1000000000")) return "A billion! Lilian respectfully removes her hat.";
  if (value >= BigInt("1000000")) return "One million! Lilian has hired an accountant.";
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
