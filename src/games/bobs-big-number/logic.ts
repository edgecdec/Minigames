export type BobExpression = "thinking" | "higher" | "lower" | "win" | "lose";

export const MAX_LEVEL = 70;
export const MAX_NUMBER = BigInt("1000000000000000000000"); // 1 Sextillion (10^21)

export interface GuessRecord {
  guess: bigint;
  result: "higher" | "lower" | "correct";
}

export interface BobsBigNumberState {
  level: number;
  minRange: bigint;
  maxRange: bigint;
  guessesLeft: number;
  maxGuessesForLevel: number;
  target: bigint;
  status: "playing" | "won" | "lost";
  expression: BobExpression;
  history: GuessRecord[];
  message: string;
}

/** Returns the max guesses allowed for a given level (Level 1 => 70, Level 70 => 1) */
export function getGuessesForLevel(level: number): number {
  return Math.max(1, 71 - level);
}

/** Formats a BigInt with thousands separators (commas). */
export function formatBigInt(val: bigint): string {
  return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Calculates the integer midpoint of minRange and maxRange for binary search. */
export function calculateMidpoint(min: bigint, max: bigint): bigint {
  if (min > max) return min;
  return min + (max - min) / BigInt(2);
}

/** Generates a random BigInt between min and max inclusive using an injectable RNG. */
export function randomBigIntInRange(
  min: bigint,
  max: bigint,
  rng: () => number = Math.random,
): bigint {
  const range = max - min + BigInt(1);
  if (range <= BigInt(1)) return min;

  const rangeStr = range.toString();
  const digits = rangeStr.length;
  let resultStr = "";
  for (let i = 0; i < digits; i++) {
    const digit = Math.floor(rng() * 10);
    resultStr += digit.toString();
  }
  const offset = BigInt(resultStr) % range;
  return min + offset;
}

export interface CreateStateOptions {
  level?: number;
  rng?: () => number;
  overrideTarget?: bigint;
}

/** Create initial state for a specified level. */
export function createInitialState(options: CreateStateOptions = {}): BobsBigNumberState {
  const level = options.level ?? 1;
  const maxGuesses = getGuessesForLevel(level);
  const target =
    options.overrideTarget ??
    randomBigIntInRange(BigInt(1), MAX_NUMBER, options.rng ?? Math.random);

  return {
    level,
    minRange: BigInt(1),
    maxRange: MAX_NUMBER,
    guessesLeft: maxGuesses,
    maxGuessesForLevel: maxGuesses,
    target,
    status: "playing",
    expression: "thinking",
    history: [],
    message: `Bob is thinking of a number between 1 and ${formatBigInt(MAX_NUMBER)}!`,
  };
}

/** Pure function to submit a guess and produce the next game state. */
export function submitGuess(
  state: BobsBigNumberState,
  guess: bigint,
): BobsBigNumberState {
  if (state.status !== "playing") {
    return state;
  }

  const guessesLeft = state.guessesLeft - 1;

  if (guess === state.target) {
    return {
      ...state,
      guessesLeft,
      status: "won",
      expression: "win",
      history: [{ guess, result: "correct" }, ...state.history],
      message: `🎉 BINGO! You guessed ${formatBigInt(guess)} correctly! Bob is amazed!`,
    };
  }

  const isTooLow = guess < state.target;
  const nextMin = isTooLow && guess >= state.minRange ? guess + BigInt(1) : state.minRange;
  const nextMax = !isTooLow && guess <= state.maxRange ? guess - BigInt(1) : state.maxRange;

  const record: GuessRecord = {
    guess,
    result: isTooLow ? "higher" : "lower",
  };

  if (guessesLeft <= 0) {
    return {
      ...state,
      minRange: nextMin,
      maxRange: nextMax,
      guessesLeft: 0,
      status: "lost",
      expression: "lose",
      history: [record, ...state.history],
      message: `💥 Game Over! Out of guesses. Bob was thinking of ${formatBigInt(state.target)}.`,
    };
  }

  return {
    ...state,
    minRange: nextMin,
    maxRange: nextMax,
    guessesLeft,
    status: "playing",
    expression: isTooLow ? "higher" : "lower",
    history: [record, ...state.history],
    message: isTooLow
      ? `📈 HIGHER! Bob says: the number is greater than ${formatBigInt(guess)}.`
      : `📉 LOWER! Bob says: the number is smaller than ${formatBigInt(guess)}.`,
  };
}
