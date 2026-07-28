/**
 * Perfect Pitch — pure rules.
 *
 * No DOM, no React, no Web Audio. Everything here is a plain function over
 * plain data so the scoring and stats can be tested without a browser. The
 * server runs these same functions to score a submitted guess, which is what
 * keeps client and server from ever disagreeing about a result.
 *
 * The whole game lives in *cents*, not hertz. Pitch perception is logarithmic:
 * being 50 Hz off at 130 Hz is a catastrophe, at 4000 Hz it's inaudible. One
 * cent is 1/1200 of an octave, so a cent is worth the same everywhere, which
 * makes it the only honest unit for both the slider and the score.
 */

/** C3 — low enough to feel like a bass note, high enough that a laptop
 *  speaker can actually reproduce it. Below ~120 Hz most of them give up. */
export const MIN_HZ = 130.8128;

/**
 * C6 — three octaves above MIN_HZ.
 *
 * The range used to reach C8, but the top two octaves were shrill enough to be
 * unpleasant to sit through, and pitch matching gets unreliable up there
 * anyway: the ear's temporal coding of pitch falls apart above a few kHz, so
 * those rounds were testing tolerance more than hearing. Cutting them also
 * makes each remaining octave a third of the draws instead of a fifth, so the
 * bass turns up in one round of every three.
 */
export const MAX_HZ = MIN_HZ * 8;

export const OCTAVE_CENTS = 1200;
export const RANGE_CENTS = 3 * OCTAVE_CENTS;

export const ROUNDS = 5;

/**
 * How far past the playable range the ribbon may travel. The ticks dissolve
 * across this margin instead of hitting a wall, so there is never a hard edge
 * to anchor on — the range has to be felt, not seen.
 */
export const PAD_CENTS = 600;

/** The random start is never handed to you. */
export const MIN_START_DISTANCE_CENTS = 300;

/** Score decay constant: a semitone off lands around 6.1 / 10. */
export const SCORE_DECAY_CENTS = 200;

/** How close to a whole octave counts as "an octave error" rather than noise. */
export const OCTAVE_TOLERANCE_CENTS = 50;

import type { TrajectoryFeatures } from "./trajectory";

export type Waveform = "sine" | "triangle" | "sawtooth";

export const WAVEFORMS: { value: Waveform; label: string }[] = [
  { value: "sine", label: "Sine" },
  { value: "triangle", label: "Triangle" },
  { value: "sawtooth", label: "Saw" },
];

// ---------------------------------------------------------------------------
// Cents <-> hertz
// ---------------------------------------------------------------------------

/** Signed interval from `fromHz` to `toHz`. Positive means `toHz` is higher. */
export function centsBetween(fromHz: number, toHz: number): number {
  return OCTAVE_CENTS * Math.log2(toHz / fromHz);
}

/** Slider position -> frequency. Position is always "cents above MIN_HZ". */
export function hzAtCents(cents: number): number {
  return MIN_HZ * Math.pow(2, cents / OCTAVE_CENTS);
}

/** Frequency -> slider position. */
export function centsAtHz(hz: number): number {
  return centsBetween(MIN_HZ, hz);
}

export function clampToPlayable(cents: number): number {
  return Math.min(RANGE_CENTS + PAD_CENTS, Math.max(-PAD_CENTS, cents));
}

// ---------------------------------------------------------------------------
// Round setup
// ---------------------------------------------------------------------------

/** Uniform in log space, so every octave is equally likely to come up. */
export function sampleTargetCents(rng: () => number = Math.random): number {
  return rng() * RANGE_CENTS;
}

/**
 * A random slider start that is never within MIN_START_DISTANCE_CENTS of the
 * answer. Picks directly from the two valid intervals rather than rejecting in
 * a loop, so it always terminates.
 */
export function sampleStartCents(
  targetCents: number,
  rng: () => number = Math.random,
): number {
  const lowSpan = Math.max(0, targetCents - MIN_START_DISTANCE_CENTS);
  const highSpan = Math.max(
    0,
    RANGE_CENTS - (targetCents + MIN_START_DISTANCE_CENTS),
  );
  const total = lowSpan + highSpan;

  // Only reachable if the range shrinks below 2x the exclusion zone.
  if (total <= 0) return targetCents;

  const pick = rng() * total;
  return pick < lowSpan
    ? pick
    : targetCents + MIN_START_DISTANCE_CENTS + (pick - lowSpan);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Cents error -> 0..10. Smooth exponential decay rather than banded, so a
 * three-cent improvement actually shows up in the history charts instead of
 * being swallowed by a bucket.
 */
export function scoreFromCents(cents: number): number {
  return 10 * Math.exp(-Math.abs(cents) / SCORE_DECAY_CENTS);
}

const TIERS: { within: number; label: string }[] = [
  { within: 5, label: "Perfect" },
  { within: 15, label: "Dead on" },
  { within: 35, label: "Excellent" },
  { within: 60, label: "Great" },
  { within: 120, label: "Good" },
  { within: 250, label: "Off" },
  { within: Infinity, label: "Way off" },
];

export function tierForCents(cents: number): string {
  const abs = Math.abs(cents);
  return TIERS.find((t) => abs <= t.within)!.label;
}

export interface OctaveError {
  /** How many whole octaves out, always >= 1. */
  octaves: number;
  direction: "sharp" | "flat";
  /** Ready-to-print call-out, e.g. "Exactly one octave high". */
  label: string;
}

/**
 * Landing a whole octave off is the signature mistake — the right note, the
 * wrong register. It scores as the disaster it is, but it earns a name.
 */
export function detectOctaveError(cents: number): OctaveError | null {
  const abs = Math.abs(cents);
  const octaves = Math.round(abs / OCTAVE_CENTS);
  if (octaves < 1) return null;

  const drift = Math.abs(abs - octaves * OCTAVE_CENTS);
  if (drift > OCTAVE_TOLERANCE_CENTS) return null;

  const direction = cents > 0 ? "sharp" : "flat";
  const count = octaves === 1 ? "one octave" : `${octaves} octaves`;
  const precision = drift <= 15 ? "Exactly" : "Almost exactly";

  return {
    octaves,
    direction,
    label: `${precision} ${count} ${direction === "sharp" ? "high" : "low"}`,
  };
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export interface Guess {
  targetHz: number;
  guessHz: number;
  /** Signed: positive means the player guessed sharp. */
  cents: number;
  score: number;
  /** How long they listened in phase one, in ms. */
  listenMs: number;
  /** How long they spent hunting in phase two, in ms. */
  huntMs: number;
  waveform: Waveform;
  at: number;
  /**
   * Where the ribbon was dropped. Optional because guesses recorded before
   * this field existed are still in players' browsers.
   */
  startCents?: number;
  /** How they got there. Absent on history predating trajectory capture. */
  traj?: TrajectoryFeatures;
}

export interface RunState {
  /** All five targets, drawn up front so a run survives a refresh intact. */
  targetCents: number[];
  startCents: number[];
  guesses: Guess[];
}

export interface RunRecord {
  at: number;
  /** Per-round scores, 0..10. */
  scores: number[];
  totalScore: number;
  meanAbsCents: number;
  waveform: Waveform;
}

export function createRun(rng: () => number = Math.random): RunState {
  const targetCents: number[] = [];
  const startCents: number[] = [];

  for (let i = 0; i < ROUNDS; i++) {
    const target = sampleTargetCents(rng);
    targetCents.push(target);
    startCents.push(sampleStartCents(target, rng));
  }

  return { targetCents, startCents, guesses: [] };
}

/**
 * Replaces the pending round's target with a fresh one.
 *
 * Used when a run is resumed after the player already heard a tone — a reload
 * would otherwise be a free replay, and a replay is the one thing this game
 * doesn't allow. Re-rolling makes refreshing pointless instead of punishing.
 */
export function rerollRound(
  run: RunState,
  index: number,
  rng: () => number = Math.random,
): RunState {
  if (index < 0 || index >= ROUNDS) return run;

  const target = sampleTargetCents(rng);
  const targetCents = [...run.targetCents];
  const startCents = [...run.startCents];
  targetCents[index] = target;
  startCents[index] = sampleStartCents(target, rng);

  return { ...run, targetCents, startCents };
}

export function isRunComplete(run: RunState): boolean {
  return run.guesses.length >= ROUNDS;
}

/** Index of the round being played, or ROUNDS once the run is done. */
export function currentRound(run: RunState): number {
  return Math.min(run.guesses.length, ROUNDS);
}

export function scoreGuess(
  targetCents: number,
  guessCents: number,
  meta: {
    listenMs: number;
    huntMs: number;
    waveform: Waveform;
    at: number;
    startCents?: number;
    traj?: TrajectoryFeatures;
  },
): Guess {
  const cents = guessCents - targetCents;
  return {
    targetHz: hzAtCents(targetCents),
    guessHz: hzAtCents(guessCents),
    cents,
    score: scoreFromCents(cents),
    ...meta,
  };
}

export function submitGuess(run: RunState, guess: Guess): RunState {
  if (isRunComplete(run)) return run;
  return { ...run, guesses: [...run.guesses, guess] };
}

export function summarizeRun(run: RunState, waveform: Waveform): RunRecord {
  const scores = run.guesses.map((g) => g.score);
  return {
    at: run.guesses.length ? run.guesses[run.guesses.length - 1].at : 0,
    scores,
    totalScore: sum(scores),
    meanAbsCents: mean(run.guesses.map((g) => Math.abs(g.cents))),
    waveform,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

/** Population standard deviation — we have the whole history, not a sample. */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Summary {
  rounds: number;
  meanAbsCents: number;
  medianAbsCents: number;
  bestAbsCents: number;
  meanScore: number;
  /** Signed mean: positive means a habit of guessing sharp. */
  bias: number;
  spread: number;
  octaveErrors: number;
  /** Fraction landing inside a semitone. */
  withinSemitone: number;
}

export function summarize(guesses: Guess[]): Summary {
  const abs = guesses.map((g) => Math.abs(g.cents));
  const signed = guesses.map((g) => g.cents);

  return {
    rounds: guesses.length,
    meanAbsCents: mean(abs),
    medianAbsCents: median(abs),
    bestAbsCents: abs.length ? Math.min(...abs) : 0,
    meanScore: mean(guesses.map((g) => g.score)),
    bias: mean(signed),
    spread: stdDev(signed),
    octaveErrors: guesses.filter((g) => detectOctaveError(g.cents) !== null)
      .length,
    withinSemitone: guesses.length
      ? abs.filter((c) => c <= 100).length / guesses.length
      : 0,
  };
}

export interface Anchoring {
  n: number;
  /**
   * Cents of error per cent of starting offset. Positive means the ribbon's
   * random starting position drags the answer toward itself.
   */
  slope: number;
  /** Pearson correlation, so a slope built on noise can be ignored. */
  r: number;
}

/** Below this the slope is fitting noise, not a person. */
const ANCHORING_MIN_SAMPLES = 20;

/**
 * Does where you started pull your answer?
 *
 * The starting position is uniformly random and independent of the target, so
 * any relationship between "how far away I was dropped" and "how far off I
 * ended up" is a genuine anchoring effect rather than an artefact. A positive
 * slope means being dropped high makes you guess high.
 *
 * Returns null until there's enough history to say anything honest.
 */
export function anchoringPull(guesses: Guess[]): Anchoring | null {
  const pairs = guesses
    .filter((g) => typeof g.startCents === "number")
    .map((g) => ({
      x: (g.startCents as number) - centsAtHz(g.targetHz),
      y: g.cents,
    }));

  if (pairs.length < ANCHORING_MIN_SAMPLES) return null;

  const meanX = mean(pairs.map((p) => p.x));
  const meanY = mean(pairs.map((p) => p.y));

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (varianceX === 0 || varianceY === 0) return null;

  return {
    n: pairs.length,
    slope: covariance / varianceX,
    r: covariance / Math.sqrt(varianceX * varianceY),
  };
}

export interface RegisterBin {
  loHz: number;
  hiHz: number;
  centerHz: number;
  n: number;
  /** Signed mean error in this band. */
  mean: number;
  sd: number;
}

/**
 * Signed error grouped by where in the range the target sat. This is the chart
 * that answers "do I run sharp in the bass and flat up top?" — bins are equal
 * width in cents, not hertz, so each holds the same musical span.
 */
export function binByRegister(guesses: Guess[], bins = 10): RegisterBin[] {
  const width = RANGE_CENTS / bins;
  const buckets: number[][] = Array.from({ length: bins }, () => []);

  for (const g of guesses) {
    const at = centsAtHz(g.targetHz);
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(at / width)));
    buckets[idx].push(g.cents);
  }

  return buckets.map((values, i) => {
    const lo = i * width;
    const hi = lo + width;
    return {
      loHz: hzAtCents(lo),
      hiHz: hzAtCents(hi),
      centerHz: hzAtCents(lo + width / 2),
      n: values.length,
      mean: mean(values),
      sd: stdDev(values),
    };
  });
}

export interface HistogramBin {
  lo: number;
  hi: number;
  center: number;
  n: number;
}

/**
 * Distribution of signed error. Everything past `clamp` is folded into the end
 * bins so a single wild octave miss can't flatten the whole chart.
 */
export function signedHistogram(
  guesses: Guess[],
  binWidth = 40,
  clamp = 400,
): HistogramBin[] {
  const edge = Math.ceil(clamp / binWidth) * binWidth;
  const count = (edge * 2) / binWidth;
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => {
    const lo = -edge + i * binWidth;
    return { lo, hi: lo + binWidth, center: lo + binWidth / 2, n: 0 };
  });

  for (const g of guesses) {
    const c = Math.min(edge - 0.001, Math.max(-edge, g.cents));
    const idx = Math.min(count - 1, Math.max(0, Math.floor((c + edge) / binWidth)));
    bins[idx].n++;
  }

  return bins;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatHz(hz: number): string {
  return hz < 1000 ? hz.toFixed(1) : hz.toFixed(0);
}

/** Always signed, so a bias readout can't be misread as an absolute error. */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

export interface NearestNote {
  name: string;
  /** How far the frequency sits from that note, signed. */
  centsOff: number;
}

/** Nearest equal-tempered note to a frequency, A4 = 440. */
export function nearestNote(hz: number): NearestNote {
  const midiExact = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(midiExact);
  return {
    name: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
    centsOff: (midiExact - midi) * 100,
  };
}
