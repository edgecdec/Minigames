/**
 * Behavioural analysis of how a player found their answer.
 *
 * The score alone can't tell you whether someone heard the pitch or read it
 * out of a variable — both produce the same number. The *path* can. A real
 * search sweeps, overshoots, reverses, narrows and then hesitates before
 * committing. An answer that was already known goes straight there.
 *
 * Nothing here proves anything. One check is a genuine impossibility (see
 * `maxScoreWithoutMoving`); the rest are evidence, and the right response to
 * evidence is to rank a run as unverified, not to accuse anyone.
 *
 * Pure functions over plain data, so the server can run exactly the same
 * checks the client recorded.
 */

import { MIN_START_DISTANCE_CENTS, scoreFromCents, stdDev } from "./logic";

export interface TrajectoryPoint {
  /** Milliseconds since the hunt phase began. */
  t: number;
  cents: number;
}

export interface TrajectoryFeatures {
  samples: number;
  /** Total ground covered, summing every movement. */
  travelCents: number;
  /** Straight-line distance from where they started to where they stopped. */
  netCents: number;
  /** netCents / travelCents. 1 is a beeline; a real search sits well below. */
  directness: number;
  /** Direction changes. Overshooting and coming back is the human signature. */
  reversals: number;
  timeToFirstMoveMs: number;
  /** The pause between the last movement and locking in. */
  settleMs: number;
  maxSpeedCentsPerSec: number;
  /** +1 arrived moving upward, -1 downward, 0 never moved. */
  approach: number;
}

export const EMPTY_FEATURES: TrajectoryFeatures = {
  samples: 0,
  travelCents: 0,
  netCents: 0,
  directness: 0,
  reversals: 0,
  timeToFirstMoveMs: 0,
  settleMs: 0,
  maxSpeedCentsPerSec: 0,
  approach: 0,
};

/**
 * The highest score reachable without touching the ribbon at all.
 *
 * The random start is guaranteed to be at least MIN_START_DISTANCE_CENTS from
 * the target, so this isn't a heuristic — beating it without moving is
 * arithmetically impossible, and a server can reject it outright.
 */
export function maxScoreWithoutMoving(): number {
  return scoreFromCents(MIN_START_DISTANCE_CENTS);
}

/**
 * Thins a raw movement log down to something worth sending over the wire,
 * always keeping the first and last points so the endpoints stay exact.
 */
export function downsample(
  points: TrajectoryPoint[],
  max: number,
): TrajectoryPoint[] {
  if (max < 2 || points.length <= max) return [...points];

  const out: TrajectoryPoint[] = [points[0]];
  // Spread the interior samples evenly across the middle of the log.
  const step = (points.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    out.push(points[Math.round(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Reduces a movement log to the handful of numbers worth storing. */
export function analyzeTrajectory(
  points: TrajectoryPoint[],
  huntMs: number,
): TrajectoryFeatures {
  if (points.length < 2) {
    return {
      ...EMPTY_FEATURES,
      samples: points.length,
      // Never moving means the whole round was hesitation.
      timeToFirstMoveMs: Math.max(0, huntMs),
      settleMs: Math.max(0, huntMs),
    };
  }

  let travel = 0;
  let reversals = 0;
  let maxSpeed = 0;
  let lastDirection = 0;
  let firstMoveT = -1;
  let lastMoveT = points[0].t;
  let approach = 0;

  for (let i = 1; i < points.length; i++) {
    const delta = points[i].cents - points[i - 1].cents;
    if (delta === 0) continue;

    travel += Math.abs(delta);
    if (firstMoveT < 0) firstMoveT = points[i].t;
    lastMoveT = points[i].t;

    const direction = Math.sign(delta);
    if (lastDirection !== 0 && direction !== lastDirection) reversals++;
    lastDirection = direction;
    approach = direction;

    const dt = Math.max(1, points[i].t - points[i - 1].t);
    maxSpeed = Math.max(maxSpeed, (Math.abs(delta) / dt) * 1000);
  }

  const net = Math.abs(points[points.length - 1].cents - points[0].cents);

  return {
    samples: points.length,
    travelCents: travel,
    netCents: net,
    directness: travel > 0 ? net / travel : 0,
    reversals,
    timeToFirstMoveMs: firstMoveT < 0 ? Math.max(0, huntMs) : firstMoveT,
    settleMs: Math.max(0, huntMs - lastMoveT),
    maxSpeedCentsPerSec: maxSpeed,
    approach,
  };
}

// --- Plausibility ----------------------------------------------------------

/** Movement below this is indistinguishable from not touching the ribbon. */
const NEVER_MOVED_CENTS = 1;
/** Above this, the path is effectively a straight line to the answer. */
const BEELINE_DIRECTNESS = 0.97;
/** A beeline only means something if it actually landed on the target. */
const BEELINE_ACCURACY_CENTS = 8;
/** No human starts moving, or commits, this fast. */
const INSTANT_MS = 60;
const NO_HESITATION_MS = 25;

export type RoundFlag =
  | "impossible-unmoved-score"
  | "never-moved"
  | "beeline"
  | "no-hesitation";

export interface RoundCheck {
  startCents: number;
  guessCents: number;
  targetCents: number;
  score: number;
  features: TrajectoryFeatures;
}

/**
 * Per-round flags. `impossible-unmoved-score` is the only one that proves
 * anything; treat the rest as weight, not verdict.
 */
export function roundFlags(check: RoundCheck): RoundFlag[] {
  const flags: RoundFlag[] = [];
  const { features } = check;
  const unmoved =
    features.travelCents < NEVER_MOVED_CENTS &&
    Math.abs(check.guessCents - check.startCents) < NEVER_MOVED_CENTS;

  if (unmoved) {
    flags.push("never-moved");
    // The start is always at least 300 cents away, so this cannot happen
    // honestly — no tolerance needed beyond floating-point slack.
    if (check.score > maxScoreWithoutMoving() + 1e-6) {
      flags.push("impossible-unmoved-score");
    }
  } else if (
    features.reversals === 0 &&
    features.directness >= BEELINE_DIRECTNESS &&
    Math.abs(check.guessCents - check.targetCents) <= BEELINE_ACCURACY_CENTS
  ) {
    flags.push("beeline");
  }

  if (
    !unmoved &&
    features.timeToFirstMoveMs < INSTANT_MS &&
    features.settleMs < NO_HESITATION_MS
  ) {
    flags.push("no-hesitation");
  }

  return flags;
}

/** No trained ear is this accurate, and none is this consistent. */
const SUPERHUMAN_MEAN_CENTS = 2;
const SUPERHUMAN_SPREAD_CENTS = 1.5;

export type RunFlag = "superhuman-accuracy" | "superhuman-consistency";

/**
 * Whole-run checks, which catch what per-round checks can't.
 *
 * The useful property here is what it does to a *careful* cheater: to stay
 * under these thresholds they have to add realistic error, at which point
 * they're scoring like a good human and no longer topping the board.
 */
export function runFlags(centsErrors: number[]): RunFlag[] {
  if (centsErrors.length < 3) return [];

  const flags: RunFlag[] = [];
  const meanAbs =
    centsErrors.reduce((a, c) => a + Math.abs(c), 0) / centsErrors.length;

  if (meanAbs < SUPERHUMAN_MEAN_CENTS) flags.push("superhuman-accuracy");
  if (stdDev(centsErrors) < SUPERHUMAN_SPREAD_CENTS) {
    flags.push("superhuman-consistency");
  }

  return flags;
}
