export type Side = "H" | "T";
export type GameResult = "win" | "lose" | null;

export interface CoinGameState {
  streak: number;
  history: Side[];
  face: Side;
  result: GameResult;
}

export const TARGET_STREAK = 10;

export function createInitialState(): CoinGameState {
  return {
    streak: 0,
    history: [],
    face: "H",
    result: null,
  };
}

export interface FlipOutcome {
  nextState: CoinGameState;
  side: Side;
  endedStreak?: number;
}

/**
 * Pure state update for flipping a coin.
 * Injectable `rng` parameter ensures outcomes are deterministic in unit tests.
 */
export function flipCoin(
  state: CoinGameState,
  rng: () => number = Math.random,
  target = TARGET_STREAK,
): FlipOutcome {
  if (state.result === "win") {
    return { nextState: state, side: state.face };
  }

  const side: Side = rng() < 0.5 ? "H" : "T";
  const history = [...state.history.slice(-(target - 1)), side];

  if (side === "H") {
    const nextStreak = state.streak + 1;
    const win = nextStreak >= target;
    return {
      nextState: {
        streak: nextStreak,
        history,
        face: side,
        result: win ? "win" : null,
      },
      side,
      endedStreak: win ? nextStreak : undefined,
    };
  } else {
    const finalStreak = state.streak;
    return {
      nextState: {
        streak: 0,
        history,
        face: side,
        result: "lose",
      },
      side,
      endedStreak: finalStreak,
    };
  }
}
