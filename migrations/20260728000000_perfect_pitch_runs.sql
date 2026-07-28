-- Perfect Pitch: server-authoritative runs.
--
-- Unlike every other game on the site, this one can't trust a score posted by
-- the client: the answer is a number, and "I scored 50/50" is one console edit
-- away. So the server draws the targets, keeps them, and scores the guesses
-- itself. The client submits a frequency it guessed, never a score.
--
-- Round N+1's target is only handed out in the response to round N's guess, so
-- a run is a chain of five exchanges rather than one number at the end.
--
-- These tables are working state plus a short audit window, not a permanent
-- history — pruneOldRuns() drops them a week after the fact. The leaderboard
-- row itself lives in the shared `scores` table like every other game.

CREATE TABLE IF NOT EXISTS pp_run (
  id           TEXT    PRIMARY KEY,      -- 128-bit random, unguessable
  user_id      TEXT    NOT NULL,         -- owner; another player can't submit it
  created_at   INTEGER NOT NULL,
  completed_at INTEGER,
  waveform     TEXT    NOT NULL DEFAULT 'sine',
  status       TEXT    NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'complete', 'submitted')),

  -- Server-computed. Full precision: the board ranks on score x 100, and
  -- rounding here would manufacture ties between good players.
  total_score  REAL,

  -- 0 when the behavioural checks found the run implausible. Kept and shown
  -- separately rather than deleted; the checks are evidence, not proof.
  verified     INTEGER NOT NULL DEFAULT 1,
  flags        TEXT                      -- JSON array of flag strings
);

CREATE INDEX IF NOT EXISTS idx_pp_run_user ON pp_run (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pp_run_created ON pp_run (created_at);

CREATE TABLE IF NOT EXISTS pp_round (
  run_id       TEXT    NOT NULL REFERENCES pp_run(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,         -- 0..4

  -- The answer. Sent to the client only as a frequency to synthesise, and only
  -- once this round is the current one.
  target_cents REAL    NOT NULL,
  -- Where the ribbon starts. Server-chosen so the client can't drop itself
  -- next to the target. Also makes the anchoring question answerable.
  start_cents  REAL    NOT NULL,

  served_at    INTEGER,                  -- when the tone went out
  answered_at  INTEGER,                  -- when the guess came back
  guess_cents  REAL,
  cents_error  REAL,                     -- signed, + is sharp
  score        REAL,

  listen_ms    INTEGER,
  hunt_ms      INTEGER,
  pointer_type TEXT,

  -- How they found it. Client-supplied and therefore forgeable, but forging a
  -- convincing one means simulating a human search rather than editing a
  -- number — which is the whole point.
  traj_samples       INTEGER,
  traj_travel        REAL,
  traj_directness    REAL,
  traj_reversals     INTEGER,
  traj_first_move_ms INTEGER,
  traj_settle_ms     INTEGER,
  traj_approach      INTEGER,
  flags              TEXT,

  PRIMARY KEY (run_id, idx)
);
