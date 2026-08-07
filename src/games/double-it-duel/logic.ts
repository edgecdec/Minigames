/**
 * Multiplayer Double It! — a passing clock, no DOM, no sockets.
 *
 * One shared prompt moves around the table. Only the ACTIVE player's clock runs.
 * Answer correctly and the prompt passes on; run your clock to zero and you're
 * out. Last player standing wins.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK, AND WHY THE GAME ENDS
 * ---------------------------------------------------------------------------
 * Everyone starts with the same time (30s by default). When you answer, the time
 * you spent comes off your clock, and `spent - abyss` is split evenly among the
 * OTHER players. The `abyss` seconds are destroyed.
 *
 * That destruction is the whole termination argument: total time on the table
 * strictly decreases by `abyss` every turn, so the pool cannot be sustained
 * forever no matter how fast everyone answers. Answer in under `abyss` seconds
 * and the pot is negative — you're taking time OFF the others, which is how a
 * fast player closes a game out.
 *
 * Clocks may overflow past the starting amount on purpose: banking time by
 * answering fast is the reward, and capping it would flatten the strategy.
 */

export const MULTIPLIERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 10_000;

/** Lobby-configurable, with bounds the server clamps to. */
export const START_SECONDS_OPTIONS = [10, 20, 30, 45, 60, 90, 120] as const;
export const ABYSS_SECONDS_OPTIONS = [0.5, 1, 2, 3, 5] as const;

export const DEFAULT_SETTINGS: DuelSettings = {
  multiplier: 2,
  startSeconds: 30,
  abyssSeconds: 1,
};

export interface DuelSettings {
  multiplier: Multiplier;
  /** Starting clock for every player. */
  startSeconds: number;
  /** Seconds destroyed per answer — the reason a game terminates. */
  abyssSeconds: number;
}

export interface DuelPlayer {
  userId: string;
  /** Milliseconds remaining. May exceed the start amount. */
  ms: number;
  alive: boolean;
  /** Correct answers given. */
  solved: number;
  /** Where they finished — 1 is the winner. Set as players are eliminated. */
  place: number | null;
}

export type DuelPhase = "lobby" | "playing" | "over";

export interface DuelState {
  phase: DuelPhase;
  settings: DuelSettings;
  players: DuelPlayer[];
  /** Index into `players` of whoever must answer now. */
  turnIndex: number;
  prompt: number;
  /** Server timestamp the current turn began, for computing time spent. */
  turnStartedAt: number;
  /** userId of the winner, or null while playing / on a total wipeout. */
  winner: string | null;
  /** Last thing that happened, so clients can narrate it. */
  lastEvent: {
    userId: string;
    kind: "correct" | "wrong" | "timeout";
    prompt: number;
    answer?: number;
    spentMs: number;
    /** Per-opponent change; negative when the answer was faster than the abyss. */
    sharedMs: number;
  } | null;
  /** Misses on the current number; reset when it is finally solved. */
  wrongThisTurn: number;
  /**
   * Time already charged to the active player during THIS turn.
   *
   * A wrong answer charges the clock and re-bases `turnStartedAt`, and a pause
   * banks the elapsed portion too — so by the time someone finally answers
   * correctly, `now - turnStartedAt` covers only the last attempt. Sharing that
   * alone quietly swallowed every second burned on a wrong guess: it came off the
   * answerer but reached nobody. This accumulator is what the others are owed.
   */
  turnSpentMs: number;
  /**
   * How many DISTINCT players have finished a turn.
   *
   * Until everyone has had one, clocks are capped at the starting amount. In the
   * first rotation the later players receive time before ever spending any, so
   * without the cap the last seat could be sitting on a big surplus before their
   * first question — a positional advantage nobody chose.
   */
  turnsTaken: number;
  round: number;
}

export function randomPrompt(rng: () => number = Math.random): number {
  return MIN_NUMBER + Math.floor(rng() * (MAX_NUMBER - MIN_NUMBER + 1));
}

export function createDuel(
  userIds: string[],
  settings: DuelSettings = DEFAULT_SETTINGS,
  now = 0,
  rng: () => number = Math.random,
): DuelState {
  return {
    phase: userIds.length >= 2 ? "playing" : "lobby",
    settings,
    players: userIds.map((userId) => ({
      userId,
      ms: settings.startSeconds * 1000,
      alive: true,
      solved: 0,
      place: null,
    })),
    turnIndex: 0,
    prompt: randomPrompt(rng),
    turnStartedAt: now,
    winner: null,
    lastEvent: null,
    wrongThisTurn: 0,
    turnSpentMs: 0,
    turnsTaken: 0,
    round: 1,
  };
}

export function activePlayer(state: DuelState): DuelPlayer | undefined {
  return state.players[state.turnIndex];
}

export function target(state: DuelState): number {
  return state.prompt * state.settings.multiplier;
}

/** Live clock for a player, accounting for the turn in progress. */
export function remainingMs(state: DuelState, userId: string, now: number): number {
  const p = state.players.find((x) => x.userId === userId);
  if (!p) return 0;
  if (state.phase !== "playing" || !p.alive) return p.ms;
  const isActive = state.players[state.turnIndex]?.userId === userId;
  if (!isActive) return p.ms;
  return Math.max(0, p.ms - (now - state.turnStartedAt));
}

function nextAliveIndex(state: DuelState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (state.players[idx].alive) return idx;
  }
  return from;
}

/**
 * Eliminate a player and, if only one remains, end the game.
 *
 * Places are assigned from the bottom up as people go out, so the survivor
 * always lands on 1st.
 */
function eliminate(state: DuelState, index: number): DuelState {
  const players = state.players.map((p, i) =>
    i === index ? { ...p, alive: false, ms: 0 } : p,
  );
  const aliveCount = players.filter((p) => p.alive).length;
  // The player just knocked out finishes one place below everyone still in.
  players[index] = { ...players[index], place: aliveCount + 1 };

  if (aliveCount <= 1) {
    const survivor = players.find((p) => p.alive);
    return {
      ...state,
      players: survivor
        ? players.map((p) => (p.userId === survivor.userId ? { ...p, place: 1 } : p))
        : players,
      phase: "over",
      winner: survivor?.userId ?? null,
    };
  }
  return { ...state, players };
}

/**
 * Apply the clock transfer for a completed turn.
 *
 * `spent` comes off the answerer; `spent - abyss` is divided among the other
 * LIVING players. A fast answer makes that negative, draining everyone else.
 */
/**
 * Settle a completed turn.
 *
 * `chargeMs` is what still has to come off the answerer's clock; `potMs` is the
 * WHOLE turn, including time already charged by earlier wrong guesses or by a
 * pause. They differ because those paths deduct as they go, and the others are
 * owed the whole turn rather than just the final attempt.
 *
 * The abyss is taken once per turn, not once per attempt — that keeps the
 * termination guarantee (exactly `abyss` ms leaves the table per completed turn)
 * without punishing the same mistake repeatedly.
 */
function settleClock(state: DuelState, chargeMs: number, potMs: number): DuelState {
  const abyssMs = state.settings.abyssSeconds * 1000;
  const active = state.players[state.turnIndex];
  const others = state.players.filter((p) => p.alive && p.userId !== active.userId);
  const pot = potMs - abyssMs;
  const share = others.length > 0 ? pot / others.length : 0;

  // NO OVERFLOW DURING THE FIRST ROTATION.
  //
  // Everyone should face their first question on an even footing. In round one
  // the later seats collect time from earlier players before spending any of
  // their own, so an uncapped first lap hands the last player a surplus purely
  // for sitting later in the order. Once everyone has taken a turn the cap comes
  // off and banking time is a legitimate reward for being fast.
  const firstRotationDone = state.turnsTaken + 1 >= state.players.length;
  const startMs = state.settings.startSeconds * 1000;

  return {
    ...state,
    players: state.players.map((p) => {
      if (p.userId === active.userId) {
        // Only the unbanked remainder: wrong guesses already took their share.
        return { ...p, ms: p.ms - chargeMs };
      }
      if (!p.alive) return p;
      // A floor of 0 stops a fast answer pushing someone negative without
      // eliminating them; the caller checks for that separately.
      const raised = Math.max(0, p.ms + share);
      // Only a GAIN is capped. A drain below the start (from a fast answer) is
      // still allowed, or the cap would refund time the opponent earned.
      const capped = firstRotationDone ? raised : Math.min(raised, startMs);
      return { ...p, ms: capped };
    }),
  };
}

/** Anyone whose clock hit zero from a transfer is out. */
function reapEmpty(state: DuelState): DuelState {
  let next = state;
  for (let i = 0; i < next.players.length; i++) {
    const p = next.players[i];
    if (p.alive && p.ms <= 0) {
      next = eliminate(next, i);
      if (next.phase === "over") return next;
    }
  }
  return next;
}

export interface AnswerResult {
  state: DuelState;
  correct: boolean;
}

/**
 * The active player submits an answer.
 *
 * A WRONG ANSWER DOES NOT END YOUR TURN. You stay on the SAME number until you
 * get it right, and your clock keeps running the whole time — which is the only
 * cost a miss needs.
 *
 * The turn used to pass on a miss, and the answerer still shared out
 * (spent - abyss). That made garbage the strongest play in the game: type any
 * number instantly, pay almost nothing, drain everyone else, and hand on a
 * prompt you never solved. You could win without doing any arithmetic.
 *
 * You are still only eliminated when your clock empties — the clock stays the
 * single currency.
 */
export function answer(
  state: DuelState,
  userId: string,
  value: number,
  now: number,
  rng: () => number = Math.random,
): AnswerResult {
  if (state.phase !== "playing") return { state, correct: false };
  const active = state.players[state.turnIndex];
  // Ignore anyone answering out of turn.
  if (!active || active.userId !== userId || !active.alive) {
    return { state, correct: false };
  }

  const spentMs = Math.max(0, now - state.turnStartedAt);

  // Ran the clock out mid-thought: settle nothing, just eliminate.
  if (spentMs >= active.ms) {
    const timedOut = eliminate(
      {
        ...state,
        turnsTaken: state.turnsTaken + 1,
        lastEvent: {
          userId,
          kind: "timeout",
          prompt: state.prompt,
          spentMs: active.ms,
          sharedMs: 0,
        },
      },
      state.turnIndex,
    );
    return { state: advance(timedOut, now, rng), correct: false };
  }

  const correct = value === target(state);

  if (!correct) {
    // No extra penalty is needed. Keeping the turn IS the cost: your clock is
    // still running on the same number, so every wrong guess spends real time
    // and hands nothing to anyone else. An added charge would just be punishing
    // the same mistake twice.
    let missed: DuelState = {
      ...state,
      players: state.players.map((p) =>
        p.userId === userId ? { ...p, ms: p.ms - spentMs } : p,
      ),
      wrongThisTurn: state.wrongThisTurn + 1,
      // Bank it so the eventual correct answer still shares this time out.
      turnSpentMs: state.turnSpentMs + spentMs,
      lastEvent: {
        userId,
        kind: "wrong",
        prompt: state.prompt,
        answer: value,
        spentMs,
        // Nothing is shared on a miss — a miss must never fund the table.
        sharedMs: 0,
      },
    };

    const me = missed.players.find((p) => p.userId === userId)!;
    if (me.ms <= 0) {
      // The penalty finished them off — same path as any other empty clock.
      // Their turn is over either way, so the rotation advances.
      missed = { ...missed, turnsTaken: state.turnsTaken + 1 };
      missed = eliminate(missed, state.turnIndex);
      if (missed.phase === "over") return { state: missed, correct: false };
      return { state: advance(missed, now, rng), correct: false };
    }

    // Still their turn on the SAME number. Re-base so the time already spent is
    // banked rather than charged again on the next attempt.
    return {
      state: { ...missed, turnStartedAt: now },
      correct: false,
    };
  }

  const abyssMs = state.settings.abyssSeconds * 1000;
  const others = state.players.filter(
    (p) => p.alive && p.userId !== active.userId,
  ).length;

  // The whole turn funds the table, not just the attempt that happened to land.
  const potMs = state.turnSpentMs + spentMs;
  let next = settleClock(state, spentMs, potMs);
  next = {
    ...next,
    players: next.players.map((p) =>
      p.userId === userId ? { ...p, solved: p.solved + 1 } : p,
    ),
    // Counts completed turns, so the first-rotation cap knows when to lift.
    turnsTaken: state.turnsTaken + 1,
    wrongThisTurn: 0,
    // Fresh accumulator for the next turn.
    turnSpentMs: 0,
    lastEvent: {
      userId,
      kind: "correct",
      prompt: state.prompt,
      answer: value,
      spentMs,
      sharedMs: others > 0 ? (potMs - abyssMs) / others : 0,
    },
  };

  next = reapEmpty(next);
  if (next.phase === "over") return { state: next, correct };
  return { state: advance(next, now, rng), correct };
}

/** Hand the turn to the next living player, optionally with a fresh prompt. */
function advance(
  state: DuelState,
  now: number,
  rng: () => number,
  newPrompt = true,
): DuelState {
  if (state.phase === "over") return state;
  const turnIndex = nextAliveIndex(state, state.turnIndex);
  return {
    ...state,
    turnIndex,
    // Clear the accumulator HERE, so every path that ends a turn clears it — a
    // timeout or an elimination would otherwise leak the dead player's spent time
    // into the next player's pot.
    turnSpentMs: 0,
    wrongThisTurn: 0,
    prompt: newPrompt ? randomPrompt(rng) : state.prompt,
    turnStartedAt: now,
    round: state.round + 1,
  };
}

/**
 * The active player's clock reached zero without an answer. Called by the
 * server's tick, since nobody will submit anything.
 */
export function expireTurn(
  state: DuelState,
  now: number,
  rng: () => number = Math.random,
): DuelState {
  if (state.phase !== "playing") return state;
  const active = state.players[state.turnIndex];
  if (!active || !active.alive) return state;
  if (now - state.turnStartedAt < active.ms) return state;

  const out = eliminate(
    {
      ...state,
      turnsTaken: state.turnsTaken + 1,
      lastEvent: {
        userId: active.userId,
        kind: "timeout",
        prompt: state.prompt,
        spentMs: active.ms,
        sharedMs: 0,
      },
    },
    state.turnIndex,
  );
  return advance(out, now, rng);
}

/** Total live time on the table — strictly decreasing, which is the point. */
export function totalMs(state: DuelState): number {
  return state.players.filter((p) => p.alive).reduce((sum, p) => sum + p.ms, 0);
}

/** Validate and clamp settings arriving from a client. */
export function cleanSettings(raw: unknown): DuelSettings {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const multiplier = MULTIPLIERS.includes(s.multiplier as Multiplier)
    ? (s.multiplier as Multiplier)
    : DEFAULT_SETTINGS.multiplier;
  const startSeconds = (START_SECONDS_OPTIONS as readonly number[]).includes(
    s.startSeconds as number,
  )
    ? (s.startSeconds as number)
    : DEFAULT_SETTINGS.startSeconds;
  const abyssSeconds = (ABYSS_SECONDS_OPTIONS as readonly number[]).includes(
    s.abyssSeconds as number,
  )
    ? (s.abyssSeconds as number)
    : DEFAULT_SETTINGS.abyssSeconds;
  return { multiplier, startSeconds, abyssSeconds };
}
