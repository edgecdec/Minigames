import type { Database } from "better-sqlite3";
import { initialize } from "./migrate.js";

/**
 * The shared SQLite handle and the global leaderboard queries behind it.
 *
 * SERVER ONLY. Never import this from a client component — it pulls in node:fs
 * and a native module, and the build will fail loudly if you try, which is the
 * intended guard.
 *
 * Schema lives in /migrations and is applied at server boot, not created here,
 * so a contributor adding a table doesn't have to edit this file (and collide
 * with everyone else who is doing the same). See the Database section of
 * AGENTS.md.
 *
 * Storage is deliberately bounded. Two rules keep this DB tiny forever:
 *
 *  1. ONE ROW PER (game, player) — a new score UPSERTs over the old one, so
 *     playing 10,000 games never adds 10,000 rows. Max size is
 *     players x games, not plays.
 *  2. Rows beyond KEEP_PER_GAME are pruned on write, so a single game's board
 *     can't grow without limit even with many one-time visitors.
 *
 * No score history, no per-play audit trail, no IP addresses.
 */

// Next re-evaluates modules on hot reload in dev. A module-level handle would
// be re-created on every edit while the previous connection stayed open, so the
// cache lives on globalThis, which survives a reload.
const cache = globalThis as typeof globalThis & {
  __minigamesDb?: Database;
  __minigamesDbError?: string;
};

/**
 * Records why the database is unavailable so callers can fail clearly. Set by
 * server.js when boot-time migration fails.
 */
export function setDatabaseError(message: string): void {
  cache.__minigamesDbError = message;
}

export function databaseError(): string | undefined {
  return cache.__minigamesDbError;
}

/**
 * The database handle, opening it on first use.
 *
 * Throws when the database is unavailable. Route handlers should catch and
 * return a 503 — a broken database must never take down the games that don't
 * use one.
 */
export function getDb(): Database {
  if (cache.__minigamesDbError) {
    throw new Error(`Database unavailable: ${cache.__minigamesDbError}`);
  }
  if (!cache.__minigamesDb) {
    // Idempotent: migrations that already ran at boot are skipped.
    const { db } = initialize();
    cache.__minigamesDb = db;
  }
  return cache.__minigamesDb;
}

/** True when database-backed features should be offered at all. */
export function databaseAvailable(): boolean {
  if (cache.__minigamesDbError) return false;
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/** Rows retained per game. Beyond this, the lowest scores are pruned. */
export const KEEP_PER_GAME = 200;
/** Entries returned to a client in one request. */
export const BOARD_LIMIT = 25;

export interface ScoreRow {
  display_name: string;
  score: number;
  updated_at: number;
  user_id: string;
}

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  at: number;
  isYou: boolean;
}

export function getBoard(
  gameSlug: string,
  userId: string | null,
  limit = BOARD_LIMIT,
): BoardEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT display_name, score, updated_at, user_id
         FROM scores
        WHERE game_slug = ?
        ORDER BY score DESC, updated_at ASC
        LIMIT ?`,
    )
    .all(gameSlug, limit) as ScoreRow[];

  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.display_name,
    score: r.score,
    at: r.updated_at,
    isYou: !!userId && r.user_id === userId,
  }));
}

/** The player's own row, so they can see their standing even when off the board. */
export function getMyEntry(
  gameSlug: string,
  userId: string,
): { score: number; name: string; rank: number } | null {
  const row = getDb()
    .prepare(
      `SELECT display_name, score FROM scores WHERE game_slug = ? AND user_id = ?`,
    )
    .get(gameSlug, userId) as { display_name: string; score: number } | undefined;
  if (!row) return null;

  const { n } = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM scores WHERE game_slug = ? AND score > ?`,
    )
    .get(gameSlug, row.score) as { n: number };

  return { score: row.score, name: row.display_name, rank: n + 1 };
}

/**
 * Record a score. Only an improvement overwrites the stored score, but the
 * display name always follows the player's latest choice so a rename applies.
 */
export function submitScore(
  gameSlug: string,
  userId: string,
  displayName: string,
  score: number,
): { accepted: boolean; best: number } {
  const db = getDb();
  const now = Date.now();

  const existing = db
    .prepare(`SELECT score FROM scores WHERE game_slug = ? AND user_id = ?`)
    .get(gameSlug, userId) as { score: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO scores
         (game_slug, user_id, display_name, score, plays, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(gameSlug, userId, displayName, score, now, now);
    prune(gameSlug);
    return { accepted: true, best: score };
  }

  if (score > existing.score) {
    db.prepare(
      `UPDATE scores
          SET display_name = ?, score = ?, plays = plays + 1, updated_at = ?
        WHERE game_slug = ? AND user_id = ?`,
    ).run(displayName, score, now, gameSlug, userId);
    prune(gameSlug);
    return { accepted: true, best: score };
  }

  // Not a personal best: count the play and honour a rename, keep the score.
  db.prepare(
    `UPDATE scores SET display_name = ?, plays = plays + 1
      WHERE game_slug = ? AND user_id = ?`,
  ).run(displayName, gameSlug, userId);
  return { accepted: false, best: existing.score };
}

/** Drops the lowest scores once a game exceeds KEEP_PER_GAME rows. */
function prune(gameSlug: string): void {
  const db = getDb();
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM scores WHERE game_slug = ?`)
    .get(gameSlug) as { n: number };
  if (n <= KEEP_PER_GAME) return;

  db.prepare(
    `DELETE FROM scores
      WHERE game_slug = ?
        AND user_id IN (
          SELECT user_id FROM scores
           WHERE game_slug = ?
           ORDER BY score DESC, updated_at ASC
           LIMIT -1 OFFSET ?
        )`,
  ).run(gameSlug, gameSlug, KEEP_PER_GAME);
}
