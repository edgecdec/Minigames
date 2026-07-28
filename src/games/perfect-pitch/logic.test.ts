import {
  MAX_HZ,
  MIN_HZ,
  MIN_START_DISTANCE_CENTS,
  OCTAVE_CENTS,
  PAD_CENTS,
  RANGE_CENTS,
  ROUNDS,
  anchoringPull,
  binByRegister,
  centsAtHz,
  centsBetween,
  clampToPlayable,
  createRun,
  detectOctaveError,
  formatCents,
  type Guess,
  hzAtCents,
  isRunComplete,
  median,
  nearestNote,
  rerollRound,
  sampleStartCents,
  sampleTargetCents,
  scoreFromCents,
  scoreGuess,
  signedHistogram,
  stdDev,
  submitGuess,
  summarize,
  tierForCents,
} from "./logic";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function close(a: number, b: number, epsilon = 1e-6) {
  return Math.abs(a - b) < epsilon;
}

// Deterministic pseudo-RNG, same shape as the Snake tests use.
function createSeededRng(seed = 12345) {
  let s = seed;
  return function rng() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function makeGuess(targetHz: number, cents: number): Guess {
  return {
    targetHz,
    guessHz: targetHz * Math.pow(2, cents / OCTAVE_CENTS),
    cents,
    score: scoreFromCents(cents),
    listenMs: 4000,
    huntMs: 5000,
    waveform: "sine",
    at: 0,
  };
}

// Test 1: cents and hertz are inverses, and the range really is three octaves
{
  assert(RANGE_CENTS === 3 * OCTAVE_CENTS, "the range is three octaves of cents");
  assert(close(MAX_HZ, MIN_HZ * 8), "and three octaves of hertz — the two agree");
  assert(close(centsAtHz(MIN_HZ), 0), "the bottom of the range is zero cents");
  assert(close(centsAtHz(MAX_HZ), RANGE_CENTS), "the top is RANGE_CENTS cents");
  assert(close(hzAtCents(centsAtHz(880)), 880, 1e-9), "hz -> cents -> hz");
  assert(
    close(centsBetween(440, 880), OCTAVE_CENTS),
    "an octave up is +1200 cents",
  );
  assert(
    close(centsBetween(440, 220), -OCTAVE_CENTS),
    "an octave down is -1200 cents",
  );
  // A cent must be worth the same musically wherever you are, which is the
  // whole reason the game doesn't score in hertz.
  assert(
    close(centsBetween(200, 200 * 1.01), centsBetween(3000, 3000 * 1.01)),
    "equal ratios give equal cents at both ends of the range",
  );
}

// Test 2: targets stay inside the range, for a lot of draws
{
  const rng = createSeededRng(7);
  for (let i = 0; i < 5000; i++) {
    const target = sampleTargetCents(rng);
    assert(
      target >= 0 && target <= RANGE_CENTS,
      `target ${target} inside the range`,
    );
  }
}

// Test 3: the start is never a gift, including at both extremes
{
  const rng = createSeededRng(99);
  for (let i = 0; i < 3000; i++) {
    const target = sampleTargetCents(rng);
    const start = sampleStartCents(target, rng);
    assert(
      Math.abs(start - target) >= MIN_START_DISTANCE_CENTS - 1e-9,
      `start ${start} is far enough from target ${target}`,
    );
    assert(start >= 0 && start <= RANGE_CENTS, "start is inside the range");
  }

  // The edges are where a naive two-interval pick goes wrong.
  for (const target of [0, RANGE_CENTS, MIN_START_DISTANCE_CENTS]) {
    for (let i = 0; i < 400; i++) {
      const start = sampleStartCents(target, rng);
      assert(
        Math.abs(start - target) >= MIN_START_DISTANCE_CENTS - 1e-9,
        `edge target ${target}: start ${start} is far enough`,
      );
      assert(
        start >= 0 && start <= RANGE_CENTS,
        `edge target ${target}: start stays in range`,
      );
    }
  }
}

// Test 4: scoring is symmetric, monotonic, and anchored at ten
{
  assert(close(scoreFromCents(0), 10), "a perfect match scores ten");
  assert(
    close(scoreFromCents(75), scoreFromCents(-75)),
    "sharp and flat by the same amount score the same",
  );

  let previous = Infinity;
  for (let c = 0; c <= 2400; c += 25) {
    const score = scoreFromCents(c);
    assert(score < previous, `score keeps falling at ${c} cents`);
    assert(score >= 0, "score never goes negative");
    previous = score;
  }

  assert(scoreFromCents(100) > 5.5 && scoreFromCents(100) < 6.5, "a semitone off is around six");
  assert(scoreFromCents(OCTAVE_CENTS) < 0.5, "an octave off is near zero");

  assert(tierForCents(2) === "Perfect", "two cents is perfect");
  assert(tierForCents(-2) === "Perfect", "tiers ignore direction");
  assert(tierForCents(5000) === "Way off", "a huge miss is way off");
}

// Test 5: octave errors are named, near-octaves are not
{
  const up = detectOctaveError(OCTAVE_CENTS);
  assert(up !== null && up.octaves === 1, "1200 cents is a one-octave error");
  assert(up!.direction === "sharp", "positive cents means guessed high");
  assert(up!.label.includes("one octave"), "the call-out names the interval");

  const down = detectOctaveError(-2 * OCTAVE_CENTS);
  assert(down !== null && down.octaves === 2, "-2400 is a two-octave error");
  assert(down!.direction === "flat", "negative cents means guessed low");

  assert(detectOctaveError(1170) !== null, "30 cents shy still counts");
  assert(detectOctaveError(1100) === null, "a whole tone shy does not");
  assert(detectOctaveError(600) === null, "a tritone is not an octave error");
  assert(detectOctaveError(0) === null, "a perfect answer is not an octave error");
  assert(detectOctaveError(30) === null, "a near-perfect answer is not either");
}

// Test 6: the ribbon can overshoot into the padding but no further
{
  assert(clampToPlayable(0) === 0, "zero is playable");
  assert(clampToPlayable(-99999) === -PAD_CENTS, "clamped at the low pad");
  assert(
    clampToPlayable(99999) === RANGE_CENTS + PAD_CENTS,
    "clamped at the high pad",
  );
}

// Test 7: a run holds five rounds and refuses a sixth
{
  const rng = createSeededRng(3);
  let run = createRun(rng);
  assert(run.targetCents.length === ROUNDS, "five targets drawn up front");
  assert(run.startCents.length === ROUNDS, "five starts drawn up front");
  assert(!isRunComplete(run), "a fresh run is not complete");

  for (let i = 0; i < ROUNDS; i++) {
    const guess = scoreGuess(run.targetCents[i], run.targetCents[i] + 20, {
      listenMs: 1000,
      huntMs: 2000,
      waveform: "sine",
      at: i,
    });
    run = submitGuess(run, guess);
  }

  assert(isRunComplete(run), "five guesses complete the run");
  const overflow = submitGuess(run, run.guesses[0]);
  assert(overflow.guesses.length === ROUNDS, "a sixth guess is refused");
}

// Test 8: scoreGuess reports signed error in the player's favour-free direction
{
  const target = centsAtHz(440);
  const sharp = scoreGuess(target, target + 50, {
    listenMs: 0,
    huntMs: 0,
    waveform: "sine",
    at: 0,
  });
  assert(close(sharp.cents, 50), "guessing above target is positive");
  assert(sharp.guessHz > sharp.targetHz, "and the frequency is higher");
  assert(close(sharp.targetHz, 440, 1e-9), "target hz round-trips");

  const flat = scoreGuess(target, target - 50, {
    listenMs: 0,
    huntMs: 0,
    waveform: "sine",
    at: 0,
  });
  assert(close(flat.cents, -50), "guessing below target is negative");
  assert(close(flat.score, sharp.score), "both directions score alike");
}

// Test 9: re-rolling replaces one round and disturbs nothing else
{
  const rng = createSeededRng(21);
  const run = submitGuess(
    createRun(rng),
    scoreGuess(100, 120, { listenMs: 0, huntMs: 0, waveform: "sine", at: 0 }),
  );
  const rerolled = rerollRound(run, 1, createSeededRng(22));

  assert(rerolled.guesses.length === 1, "the answered round survives");
  assert(
    rerolled.targetCents[1] !== run.targetCents[1],
    "the pending target changed",
  );
  assert(
    rerolled.targetCents[0] === run.targetCents[0] &&
      rerolled.targetCents[2] === run.targetCents[2],
    "other rounds are untouched",
  );
  assert(
    Math.abs(rerolled.startCents[1] - rerolled.targetCents[1]) >=
      MIN_START_DISTANCE_CENTS - 1e-9,
    "the new start still isn't a gift",
  );
  assert(
    rerollRound(run, 9, rng) === run,
    "an out-of-bounds index is a no-op",
  );
}

// Test 10: summary statistics
{
  const guesses = [
    makeGuess(440, 10),
    makeGuess(440, 30),
    makeGuess(440, 50),
    makeGuess(880, -1200),
  ];
  const s = summarize(guesses);

  assert(s.rounds === 4, "counts every round");
  assert(close(s.meanAbsCents, (10 + 30 + 50 + 1200) / 4), "mean absolute error");
  assert(close(s.medianAbsCents, 40), "median absolute error");
  assert(close(s.bestAbsCents, 10), "best round is the smallest miss");
  assert(s.octaveErrors === 1, "the octave slip is counted once");
  assert(close(s.withinSemitone, 0.75), "three of four land inside a semitone");
  assert(s.bias < 0, "one big flat miss drags the bias flat");

  // Sanity-check the spread helper against a hand-computed case.
  assert(close(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2), "population sd");
  assert(stdDev([5]) === 0, "a single sample has no spread");
  assert(close(median([1, 2, 3, 4]), 2.5), "median of an even count");
  assert(close(median([3, 1, 2]), 2), "median sorts first");
  assert(summarize([]).rounds === 0, "an empty history doesn't divide by zero");
}

// Test 11: register bins land guesses where they belong
{
  const bins = binByRegister(
    [
      // Bottom bin: 360 cents wide when there are ten of them.
      makeGuess(hzAtCents(10), 40),
      makeGuess(hzAtCents(100), 60),
      // Top bin.
      makeGuess(hzAtCents(RANGE_CENTS - 10), -20),
      // Exactly on the top edge — must not fall off the end of the array.
      makeGuess(MAX_HZ, 0),
    ],
    10,
  );

  assert(bins.length === 10, "ten bins requested, ten returned");
  assert(bins[0].n === 2, "both low guesses land in the first bin");
  assert(close(bins[0].mean, 50), "mean of the first bin");
  assert(bins[9].n === 2, "the top-edge guess clamps into the last bin");
  assert(bins[5].n === 0, "an empty bin reports zero, not NaN");
  assert(bins[5].mean === 0 && bins[5].sd === 0, "empty bins are finite");
  assert(close(bins[0].loHz, MIN_HZ), "first bin starts at the bottom");
  assert(close(bins[9].hiHz, MAX_HZ, 1e-9), "last bin ends at the top");
}

// Test 12: the histogram keeps every guess, folding outliers into the ends
{
  const guesses = [
    makeGuess(440, 0),
    makeGuess(440, 39),
    makeGuess(440, -39),
    makeGuess(440, 5000),
    makeGuess(440, -5000),
  ];
  const bars = signedHistogram(guesses, 40, 400);
  const total = bars.reduce((a, b) => a + b.n, 0);

  assert(total === guesses.length, "no guess is dropped");
  assert(bars[bars.length - 1].n === 1, "a huge sharp miss folds into the top bar");
  assert(bars[0].n === 1, "a huge flat miss folds into the bottom bar");
  assert(
    bars.every((b) => b.hi > b.lo),
    "every bar has positive width",
  );
  assert(signedHistogram([], 40, 400).every((b) => b.n === 0), "empty is empty");
}

// Test 13: note names and formatting
{
  assert(nearestNote(440).name === "A4", "440 Hz is A4");
  assert(close(nearestNote(440).centsOff, 0, 1e-9), "and it is dead in tune");
  assert(nearestNote(MIN_HZ).name === "C3", "the bottom of the range is C3");
  assert(nearestNote(MAX_HZ).name === "C6", "the top of the range is C6");
  assert(nearestNote(261.6256).name === "C4", "middle C");
  assert(Math.abs(nearestNote(453).centsOff) < 55, "off-tune notes stay near their neighbour");

  assert(formatCents(0) === "0", "zero has no sign");
  assert(formatCents(12.4) === "+12", "sharp is signed and rounded");
  assert(formatCents(-12.4) === "−12", "flat uses a real minus sign");
}

// Test 14: anchoring — does where you were dropped drag your answer?
{
  const rng = createSeededRng(1234);

  function withStart(targetCents: number, startCents: number, cents: number): Guess {
    return {
      ...makeGuess(hzAtCents(targetCents), cents),
      startCents,
    };
  }

  assert(anchoringPull([]) === null, "no history, no claim");
  assert(
    anchoringPull([withStart(1000, 2000, 30)]) === null,
    "one round is not evidence",
  );
  assert(
    anchoringPull(
      Array.from({ length: 40 }, () => makeGuess(440, 20)),
    ) === null,
    "guesses recorded before start positions were stored are skipped",
  );

  // A planted 25% pull: a quarter of the starting offset leaks into the answer.
  const pulled = Array.from({ length: 400 }, () => {
    const target = rng() * RANGE_CENTS;
    const start = sampleStartCents(target, rng);
    const offset = start - target;
    return withStart(target, start, offset * 0.25 + (rng() - 0.5) * 60);
  });

  const found = anchoringPull(pulled)!;
  assert(found !== null, "400 rounds is plenty to measure");
  assert(found.n === 400, "every usable round is counted");
  assert(
    Math.abs(found.slope - 0.25) < 0.03,
    `recovers the planted slope, got ${found.slope.toFixed(3)}`,
  );
  assert(found.r > 0.8, "and reports a strong correlation");

  // The honest case: error genuinely independent of where you started.
  const independent = Array.from({ length: 400 }, () => {
    const target = rng() * RANGE_CENTS;
    const start = sampleStartCents(target, rng);
    return withStart(target, start, (rng() - 0.5) * 200);
  });

  const none = anchoringPull(independent)!;
  assert(
    Math.abs(none.slope) < 0.05,
    `no pull means a slope near zero, got ${none.slope.toFixed(3)}`,
  );
  assert(Math.abs(none.r) < 0.2, "and a correlation near zero");

  // Identical inputs have no variance to regress against — must not divide by zero.
  const flat = Array.from({ length: 40 }, () => withStart(1000, 1400, 25));
  assert(anchoringPull(flat) === null, "zero variance returns null, not NaN");
}

console.log("All Perfect Pitch logic tests passed successfully!");
