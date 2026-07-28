import { MIN_START_DISTANCE_CENTS, scoreFromCents } from "./logic";
import {
  type TrajectoryPoint,
  analyzeTrajectory,
  downsample,
  maxScoreWithoutMoving,
  roundFlags,
  runFlags,
} from "./trajectory";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function close(a: number, b: number, epsilon = 1e-6) {
  return Math.abs(a - b) < epsilon;
}

/** A plausible hunt: sweep toward the target, overshoot, come back, settle. */
function humanHunt(start: number, target: number): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [{ t: 0, cents: start }];
  const overshoot = target + 180;
  for (let i = 1; i <= 12; i++) {
    points.push({ t: 120 * i, cents: start + ((overshoot - start) * i) / 12 });
  }
  for (let i = 1; i <= 6; i++) {
    points.push({ t: 1440 + 90 * i, cents: overshoot - (220 * i) / 6 });
  }
  for (let i = 1; i <= 4; i++) {
    points.push({ t: 1980 + 70 * i, cents: target - 40 + (40 * i) / 4 });
  }
  return points;
}

/** What reading the answer out of a variable looks like. */
function beeline(start: number, target: number): TrajectoryPoint[] {
  return [
    { t: 0, cents: start },
    { t: 8, cents: start + (target - start) / 2 },
    { t: 16, cents: target },
  ];
}

// Test 1: never moving is bounded by arithmetic, not by judgement
{
  const ceiling = maxScoreWithoutMoving();
  assert(
    close(ceiling, scoreFromCents(MIN_START_DISTANCE_CENTS)),
    "the ceiling is the score at the minimum start distance",
  );
  assert(ceiling < 2.3, "and it is a bad score — around 2.2 / 10");

  // Every possible unmoved guess, swept across the whole range of legal starts.
  for (let distance = MIN_START_DISTANCE_CENTS; distance <= 6000; distance += 25) {
    assert(
      scoreFromCents(distance) <= ceiling + 1e-9,
      `an unmoved guess ${distance} cents out cannot beat the ceiling`,
    );
  }
}

// Test 2: a still ribbon reads as still
{
  const features = analyzeTrajectory([{ t: 0, cents: 1000 }], 5000);
  assert(features.travelCents === 0, "no travel");
  assert(features.reversals === 0, "no reversals");
  assert(features.approach === 0, "no approach direction");
  assert(features.settleMs === 5000, "the whole round was hesitation");
  assert(features.directness === 0, "directness is defined, not NaN");

  const flags = roundFlags({
    startCents: 1000,
    guessCents: 1000,
    targetCents: 1000 + MIN_START_DISTANCE_CENTS,
    score: scoreFromCents(MIN_START_DISTANCE_CENTS),
    features,
  });
  assert(flags.includes("never-moved"), "not moving is flagged");
  assert(
    !flags.includes("impossible-unmoved-score"),
    "but scoring exactly the ceiling is legal, if unlucky",
  );

  const forged = roundFlags({
    startCents: 1000,
    guessCents: 1000,
    targetCents: 1000,
    score: 10,
    features,
  });
  assert(
    forged.includes("impossible-unmoved-score"),
    "a perfect score without moving is impossible",
  );
}

// Test 3: a real hunt looks like a real hunt
{
  const points = humanHunt(500, 2600);
  const features = analyzeTrajectory(points, 2300);

  assert(features.reversals >= 1, "a human overshoots and comes back");
  assert(
    features.travelCents > features.netCents,
    "and covers more ground than the straight-line distance",
  );
  assert(features.directness < 0.95, "so it is not a beeline");
  assert(features.samples === points.length, "every sample counted");
  assert(features.approach === 1, "this one arrived moving upward");

  const flags = roundFlags({
    startCents: 500,
    guessCents: points[points.length - 1].cents,
    targetCents: 2600,
    score: 9,
    features,
  });
  assert(flags.length === 0, "an honest hunt raises nothing");
}

// Test 4: a straight line to the answer is flagged
{
  const points = beeline(500, 2600);
  const features = analyzeTrajectory(points, 20);

  assert(features.reversals === 0, "no reversals");
  assert(close(features.directness, 1), "perfectly direct");

  const flags = roundFlags({
    startCents: 500,
    guessCents: 2600,
    targetCents: 2600,
    score: 10,
    features,
  });
  assert(flags.includes("beeline"), "a direct line onto the target is flagged");
  assert(flags.includes("no-hesitation"), "and so is the lack of any pause");
  assert(
    !flags.includes("impossible-unmoved-score"),
    "but it is evidence, not proof — the ribbon did move",
  );
}

// Test 5: a direct move that MISSES is not suspicious
{
  // Confidently sliding somewhere and being wrong is just being wrong.
  const points = beeline(500, 2600);
  const flags = roundFlags({
    startCents: 500,
    guessCents: 2600,
    targetCents: 2900,
    score: scoreFromCents(300),
    features: analyzeTrajectory(points, 20),
  });
  assert(!flags.includes("beeline"), "a beeline that misses is not flagged");
}

// Test 6: approach direction, which is what could explain a sharp/flat habit
{
  const fromAbove = analyzeTrajectory(
    [
      { t: 0, cents: 1000 },
      { t: 100, cents: 2000 },
      { t: 200, cents: 1500 },
    ],
    300,
  );
  assert(fromAbove.approach === -1, "last move downward means arriving from above");
  assert(fromAbove.reversals === 1, "one direction change");
  assert(close(fromAbove.travelCents, 1500), "travel counts both legs");
  assert(close(fromAbove.netCents, 500), "net is start to finish");
}

// Test 7: speed and timing
{
  const features = analyzeTrajectory(
    [
      { t: 0, cents: 0 },
      { t: 500, cents: 10 },     // slow: 20 cents/sec
      { t: 600, cents: 510 },    // fast: 5000 cents/sec
      { t: 700, cents: 520 },
    ],
    1200,
  );
  assert(close(features.maxSpeedCentsPerSec, 5000), "peak speed is the fastest leg");
  assert(features.timeToFirstMoveMs === 500, "first move is the first real change");
  assert(features.settleMs === 500, "settle is the gap after the last move");
}

// Test 8: repeated identical samples are not movement
{
  const features = analyzeTrajectory(
    [
      { t: 0, cents: 800 },
      { t: 100, cents: 800 },
      { t: 200, cents: 800 },
    ],
    400,
  );
  assert(features.travelCents === 0, "holding still is not travel");
  assert(features.reversals === 0, "and not a reversal");
  assert(
    features.timeToFirstMoveMs === 400,
    "never moving means the first move never happened",
  );
}

// Test 9: downsampling keeps the endpoints exact
{
  const points: TrajectoryPoint[] = Array.from({ length: 500 }, (_, i) => ({
    t: i * 10,
    cents: i * 3,
  }));
  const thinned = downsample(points, 48);

  assert(thinned.length === 48, "thinned to the requested size");
  assert(thinned[0].t === 0 && thinned[0].cents === 0, "first point is exact");
  assert(
    thinned[47].t === 4990 && thinned[47].cents === 1497,
    "last point is exact — the final answer must not be approximated",
  );
  assert(
    thinned.every((p, i) => i === 0 || p.t > thinned[i - 1].t),
    "and time still runs forward",
  );

  const short = downsample(points.slice(0, 10), 48);
  assert(short.length === 10, "a short trace is left alone");
  assert(downsample(points, 1).length === points.length, "a silly cap is ignored");
  assert(downsample([], 48).length === 0, "an empty trace survives");
}

// Test 10: run-level checks catch what per-round checks can't
{
  assert(runFlags([1, 2]).length === 0, "too few rounds to judge");

  const human = runFlags([-38, 62, -14, 91, 25]);
  assert(human.length === 0, "an ordinary run raises nothing");

  const perfect = runFlags([0.2, -0.1, 0.3, 0.1, -0.2]);
  assert(
    perfect.includes("superhuman-accuracy"),
    "nobody is accurate to a fifth of a cent five times running",
  );
  assert(perfect.includes("superhuman-consistency"), "nor that consistent");

  // The interesting case: a cheater adding jitter to look human. They evade
  // the filter, but only by giving up the scores that would top the board.
  const jittered = runFlags([-24, 31, -18, 27, -35]);
  assert(jittered.length === 0, "realistic jitter passes");
  const meanAbs = [-24, 31, -18, 27, -35].reduce((a, c) => a + Math.abs(c), 0) / 5;
  assert(meanAbs > 20, "but it costs them roughly 27 cents of accuracy per round");

  // Consistently biased but imprecise is a real person, not a robot.
  const biased = runFlags([40, 44, 38, 46, 42]);
  assert(
    !biased.includes("superhuman-accuracy"),
    "a steady 40-cent lean is not accuracy",
  );
}

console.log("All Perfect Pitch trajectory tests passed successfully!");
