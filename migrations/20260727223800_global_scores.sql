-- Baseline: the global leaderboard table.
--
-- This schema already exists in production, where it was created inline by
-- getDb() before migrations existed. IF NOT EXISTS is therefore load-bearing,
-- not defensive habit — on the live database this migration is a no-op that
-- simply records the schema as already applied, and on a fresh clone it builds
-- it from scratch. Both paths end up identical.
--
-- One row per (game, player). A new score UPSERTs over the old one, so the
-- table grows with players, never with plays.

CREATE TABLE IF NOT EXISTS scores (
  game_slug    TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  score        INTEGER NOT NULL,
  plays        INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,   -- ms epoch, first submission
  updated_at   INTEGER NOT NULL,   -- ms epoch, best-score submission
  PRIMARY KEY (game_slug, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_board
  ON scores(game_slug, score DESC, updated_at ASC);
