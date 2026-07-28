import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import {
  type Waveform,
  ROUNDS,
  createRun,
  hzAtCents,
  sampleStartCents,
  sampleTargetCents,
  scoreFromCents,
} from "./logic";
import {
  type TrajectoryPoint,
  analyzeTrajectory,
  roundFlags,
  runFlags,
} from "./trajectory";

/**
 * Server-side run state for Perfect Pitch. SERVER ONLY — imports the database.
 *
 * The rule that shapes all of this: the client is told a frequency to play and
 * nothing else. It sends back where it thinks the tone was; the server owns
 * the target, the arithmetic and the verdict.
 */

/** No human answers this fast: fade-in alone is 220ms, plus the silent gap. */
const MIN_ANSWER_MS = 800;
/** A round left open this long was abandoned, not played. */
const MAX_ANSWER_MS = 15 * 60 * 1000;

/** Runs are working state plus a short audit window, not a permanent history. */
const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ABANDONED_RUN_MS = 2 * 60 * 60 * 1000;

/**
 * Flags that settle it on their own, because the server can prove them from
 * values the client never had a say in:
 *
 *  - the superhuman pair come from errors the server computed itself
 *  - a trajectory that doesn't end where the guess landed is a fabrication,
 *    checked against a start position the server chose
 *  - beating the unmoved-score ceiling is arithmetically impossible
 */
const DAMNING_FLAGS = new Set([
  "superhuman-accuracy",
  "superhuman-consistency",
  "trajectory-mismatch",
  "impossible-unmoved-score",
]);

/**
 * Everything else is soft evidence from a client-supplied path — a fast,
 * direct round happens to real people, so it takes a pattern of them.
 */
const MAX_SOFT_FLAGS = 2;

/** The trajectory must actually agree with the guess it came with. */
const TRAJECTORY_TOLERANCE_CENTS = 2;

export interface ServedRound {
  index: number;
  targetHz: number;
  startCents: number;
}

export interface RoundOutcome {
  index: number;
  targetHz: number;
  guessHz: number;
  cents: number;
  score: number;
}

export interface GuessInput {
  /**
   * Which round this answers. Required, and checked against the round the
   * server is actually waiting on — otherwise a retried or duplicated request
   * would silently consume the NEXT round with a stale guess.
   */
  roundIndex: number;
  guessCents: number;
  listenMs: number;
  huntMs: number;
  pointerType?: string;
  trajectory?: TrajectoryPoint[];
}

interface RunRow {
  id: string;
  user_id: string;
  status: string;
  waveform: string;
  total_score: number | null;
}

interface RoundRow {
  idx: number;
  target_cents: number;
  start_cents: number;
  served_at: number | null;
  answered_at: number | null;
  guess_cents: number | null;
  cents_error: number | null;
  score: number | null;
}

export class RunError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Drops runs past their retention window, and active runs nobody finished.
 *
 * Called opportunistically when a run starts rather than on a timer — there's
 * no scheduler here, and a bounded table matters more than punctuality.
 */
export function pruneOldRuns(now = Date.now()): number {
  const db = getDb();
  const old = db
    .prepare(`DELETE FROM pp_run WHERE created_at < ?`)
    .run(now - RUN_RETENTION_MS).changes;
  const abandoned = db
    .prepare(
      `DELETE FROM pp_run WHERE status = 'active' AND created_at < ?`,
    )
    .run(now - ABANDONED_RUN_MS).changes;
  return old + abandoned;
}

/** Draws five targets, stores them, and serves only the first. */
export function startRun(
  userId: string,
  waveform: Waveform = "sine",
  rng: () => number = Math.random,
  now = Date.now(),
): { runId: string; round: ServedRound } {
  const db = getDb();
  pruneOldRuns(now);

  const runId = crypto.randomUUID().replace(/-/g, "");
  const plan = createRun(rng);

  const insertRun = db.prepare(
    `INSERT INTO pp_run (id, user_id, created_at, waveform, status)
     VALUES (?, ?, ?, ?, 'active')`,
  );
  const insertRound = db.prepare(
    `INSERT INTO pp_round (run_id, idx, target_cents, start_cents)
     VALUES (?, ?, ?, ?)`,
  );

  db.transaction(() => {
    insertRun.run(runId, userId, now, waveform);
    for (let i = 0; i < ROUNDS; i++) {
      insertRound.run(runId, i, plan.targetCents[i], plan.startCents[i]);
    }
  })();

  return { runId, round: serveRound(runId, 0, now) };
}

function loadRun(runId: unknown, userId: string): RunRow {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new RunError("Missing run id");
  }
  const row = getDb()
    .prepare(
      `SELECT id, user_id, status, waveform, total_score FROM pp_run WHERE id = ?`,
    )
    .get(runId) as RunRow | undefined;

  if (!row) throw new RunError("Run not found", 404);
  // Not "forbidden" with a reason — an attacker learns nothing from a 404.
  if (row.user_id !== userId) throw new RunError("Run not found", 404);
  return row;
}

/** Marks a round as served and returns what the client is allowed to know. */
function serveRound(runId: string, index: number, now: number): ServedRound {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT idx, target_cents, start_cents, served_at
         FROM pp_round WHERE run_id = ? AND idx = ?`,
    )
    .get(runId, index) as RoundRow | undefined;

  if (!row) throw new RunError("Round not found", 404);

  db.prepare(`UPDATE pp_round SET served_at = ? WHERE run_id = ? AND idx = ?`)
    .run(now, runId, index);

  return {
    index: row.idx,
    targetHz: hzAtCents(row.target_cents),
    startCents: row.start_cents,
  };
}

/**
 * Resumes an interrupted run.
 *
 * If the pending round's tone already went out, its target is re-rolled.
 * Reloading the page must never be a way to hear the same tone twice — the
 * offline mode enforces the same rule, but here the server does it.
 */
export function resumeRun(
  runId: unknown,
  userId: string,
  rng: () => number = Math.random,
  now = Date.now(),
): { runId: string; round: ServedRound; answered: number } {
  const run = loadRun(runId, userId);
  if (run.status !== "active") throw new RunError("Run already finished", 409);

  const db = getDb();
  const pending = db
    .prepare(
      `SELECT idx, target_cents, start_cents, served_at
         FROM pp_round
        WHERE run_id = ? AND answered_at IS NULL
        ORDER BY idx LIMIT 1`,
    )
    .get(run.id) as RoundRow | undefined;

  if (!pending) throw new RunError("Nothing left to play", 409);

  if (pending.served_at !== null) {
    const target = sampleTargetCents(rng);
    db.prepare(
      `UPDATE pp_round SET target_cents = ?, start_cents = ?, served_at = NULL
        WHERE run_id = ? AND idx = ?`,
    ).run(target, sampleStartCents(target, rng), run.id, pending.idx);
  }

  const answered = db
    .prepare(
      `SELECT COUNT(*) AS n FROM pp_round WHERE run_id = ? AND answered_at IS NOT NULL`,
    )
    .get(run.id) as { n: number };

  return {
    runId: run.id,
    round: serveRound(run.id, pending.idx, now),
    answered: answered.n,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Scores one guess and, unless the run is over, serves the next round.
 *
 * Everything the client sent is untrusted: the guess is clamped to the
 * playable range, the score is computed here, and the trajectory is checked
 * for agreeing with the guess it arrived with.
 */
export function recordGuess(
  runId: unknown,
  userId: string,
  input: GuessInput,
  now = Date.now(),
): { result: RoundOutcome; next: ServedRound | null; totalScore: number } {
  const run = loadRun(runId, userId);
  if (run.status !== "active") throw new RunError("Run already finished", 409);

  const db = getDb();
  const round = db
    .prepare(
      `SELECT idx, target_cents, start_cents, served_at
         FROM pp_round
        WHERE run_id = ? AND answered_at IS NULL
        ORDER BY idx LIMIT 1`,
    )
    .get(run.id) as RoundRow | undefined;

  if (!round) throw new RunError("Nothing left to answer", 409);
  if (round.served_at === null) throw new RunError("Round was never served", 409);
  if (input.roundIndex !== round.idx) {
    throw new RunError("That round has already been answered", 409);
  }

  const elapsed = now - round.served_at;
  if (elapsed < MIN_ANSWER_MS) {
    throw new RunError("That was too fast to be real", 400);
  }
  if (elapsed > MAX_ANSWER_MS) {
    throw new RunError("That round expired", 410);
  }

  if (!Number.isFinite(input.guessCents)) {
    throw new RunError("Invalid guess");
  }

  const cents = input.guessCents - round.target_cents;
  const score = scoreFromCents(cents);

  // --- behavioural checks -------------------------------------------------
  const trajectory = Array.isArray(input.trajectory) ? input.trajectory : [];
  const features = analyzeTrajectory(trajectory, Math.max(0, input.huntMs || 0));
  const flags: string[] = [
    ...roundFlags({
      startCents: round.start_cents,
      guessCents: input.guessCents,
      targetCents: round.target_cents,
      score,
      features,
    }),
  ];

  // A trajectory that doesn't end where the guess landed is a fabrication, and
  // this is checked against values only the server knows.
  if (trajectory.length > 0) {
    const first = trajectory[0].cents;
    const last = trajectory[trajectory.length - 1].cents;
    if (
      Math.abs(first - round.start_cents) > TRAJECTORY_TOLERANCE_CENTS ||
      Math.abs(last - input.guessCents) > TRAJECTORY_TOLERANCE_CENTS
    ) {
      flags.push("trajectory-mismatch");
    }
  } else {
    flags.push("no-trajectory");
  }

  db.prepare(
    `UPDATE pp_round
        SET answered_at = ?, guess_cents = ?, cents_error = ?, score = ?,
            listen_ms = ?, hunt_ms = ?, pointer_type = ?,
            traj_samples = ?, traj_travel = ?, traj_directness = ?,
            traj_reversals = ?, traj_first_move_ms = ?, traj_settle_ms = ?,
            traj_approach = ?, flags = ?
      WHERE run_id = ? AND idx = ?`,
  ).run(
    now,
    input.guessCents,
    cents,
    score,
    clampInt(input.listenMs),
    clampInt(input.huntMs),
    typeof input.pointerType === "string" ? input.pointerType.slice(0, 16) : null,
    features.samples,
    features.travelCents,
    features.directness,
    features.reversals,
    Math.round(features.timeToFirstMoveMs),
    Math.round(features.settleMs),
    features.approach,
    flags.length ? JSON.stringify(flags) : null,
    run.id,
    round.idx,
  );

  const answered = db
    .prepare(
      `SELECT idx, cents_error, score FROM pp_round
        WHERE run_id = ? AND answered_at IS NOT NULL ORDER BY idx`,
    )
    .all(run.id) as RoundRow[];

  const totalScore = answered.reduce((a, r) => a + (r.score ?? 0), 0);
  const complete = answered.length >= ROUNDS;

  if (complete) {
    finalizeRun(run.id, answered, totalScore, now);
  }

  return {
    result: {
      index: round.idx,
      targetHz: hzAtCents(round.target_cents),
      guessHz: hzAtCents(input.guessCents),
      cents,
      score,
    },
    next: complete ? null : serveRound(run.id, round.idx + 1, now),
    totalScore,
  };
}

/** Closes a run and decides whether it's plausible enough to rank. */
function finalizeRun(
  runId: string,
  rounds: RoundRow[],
  totalScore: number,
  now: number,
): void {
  const db = getDb();

  // Statistical checks over errors the server computed itself. A careful
  // cheater can fake a convincing movement path, but to get under these they
  // have to actually be wrong sometimes — at which point they aren't winning.
  const flags: string[] = [...runFlags(rounds.map((r) => r.cents_error ?? 0))];

  for (const row of rounds) {
    const stored = db
      .prepare(`SELECT flags FROM pp_round WHERE run_id = ? AND idx = ?`)
      .get(runId, row.idx) as { flags: string | null } | undefined;
    if (!stored?.flags) continue;
    for (const f of JSON.parse(stored.flags) as string[]) {
      if (!flags.includes(f)) flags.push(f);
    }
  }

  // One provable flag is enough; soft ones have to add up. Lumping them into a
  // single count let a run with two unfakeable superhuman flags sit exactly on
  // the tolerance and pass.
  const damning = flags.some((f) => DAMNING_FLAGS.has(f));
  const soft = flags.filter(
    (f) => !DAMNING_FLAGS.has(f) && f !== "no-trajectory",
  ).length;
  const verified = !damning && soft <= MAX_SOFT_FLAGS;

  db.prepare(
    `UPDATE pp_run
        SET status = 'complete', completed_at = ?, total_score = ?,
            verified = ?, flags = ?
      WHERE id = ?`,
  ).run(
    now,
    totalScore,
    verified ? 1 : 0,
    flags.length ? JSON.stringify(flags) : null,
    runId,
  );
}

/**
 * A finished run, ready to post to the board. Marks it submitted so the same
 * run can't be banked twice.
 */
export function claimRunForSubmission(
  runId: unknown,
  userId: string,
): { totalScore: number; verified: boolean; flags: string[] } {
  const run = loadRun(runId, userId);
  if (run.status === "submitted") {
    throw new RunError("That run was already submitted", 409);
  }
  if (run.status !== "complete") {
    throw new RunError("Finish the run first", 409);
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT total_score, verified, flags FROM pp_run WHERE id = ?`)
    .get(run.id) as { total_score: number; verified: number; flags: string | null };

  db.prepare(`UPDATE pp_run SET status = 'submitted' WHERE id = ?`).run(run.id);

  return {
    totalScore: row.total_score ?? 0,
    verified: row.verified === 1,
    flags: row.flags ? (JSON.parse(row.flags) as string[]) : [],
  };
}

function clampInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(3_600_000, Math.round(value)));
}
