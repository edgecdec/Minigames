"use strict";

/**
 * SQLite connection + schema migrations.
 *
 * Plain CommonJS on purpose. server.js is the entry point for BOTH `npm run
 * dev` and production, and it can't import TypeScript — so putting the runner
 * here means there is exactly one implementation rather than a TS copy and a
 * JS copy that drift apart.
 *
 * The contract for contributors:
 *
 *   - Migrations live in /migrations as `<timestamp>_<description>.sql`.
 *   - They are applied in filename order, once each, and recorded in the
 *     schema_migrations table.
 *   - They run automatically at server boot. Nobody has to log into the box
 *     and nobody has to tell other contributors to do anything — pull, restart,
 *     done.
 *   - Once a migration has been merged to main it is FROZEN. Fix mistakes by
 *     adding another migration, never by editing one that may already have run
 *     somewhere.
 *
 * See the Database section of AGENTS.md for the full rules.
 */

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

/**
 * Resolved from the working directory, NOT from __dirname.
 *
 * server.js requires this file directly, but the Next app imports it through
 * webpack, which rewrites __dirname to the bundle's location — so a
 * __dirname-relative path silently pointed the two callers at two different
 * database files. pm2 and `npm run dev` both start in the app directory, and
 * the deploy script cds there first, so cwd is the stable anchor.
 */
const APP_DIR = process.cwd();

/** Overridable so tests and one-off scripts don't touch the real database. */
const DEFAULT_DATA_DIR =
  process.env.MINIGAMES_DATA_DIR || path.join(APP_DIR, "data");
const DEFAULT_MIGRATIONS_DIR = path.join(APP_DIR, "migrations");

/**
 * Opens the database, creating the directory on first run so a fresh clone
 * needs no setup step.
 *
 * @param {{ dataDir?: string, filename?: string }} [options]
 * @returns {import("better-sqlite3").Database}
 */
function openDatabase(options = {}) {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(path.join(dataDir, options.filename || "minigames.db"));

  // WAL lets readers run while a write is in flight, and keeps things correct
  // if pm2 is ever switched from fork to cluster mode. busy_timeout is what
  // turns a concurrent write from an instant SQLITE_BUSY error into a short
  // wait. NORMAL is the standard durability tradeoff to pair with WAL.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  return db;
}

/**
 * Snapshots the database before a migration batch. VACUUM INTO is used rather
 * than copying the file, because copying an open WAL database can capture a
 * torn state — VACUUM INTO always writes a consistent snapshot.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} dataDir
 * @returns {string} path to the snapshot
 */
function snapshot(db, dataDir) {
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `minigames-${stamp}.db`);
  db.prepare("VACUUM INTO ?").run(dest);
  return dest;
}

/**
 * Applies every migration that hasn't run yet.
 *
 * Each file runs inside its own transaction, so a failure part-way through a
 * file leaves the database exactly as it was rather than half-migrated. SQLite
 * supports transactional DDL, which is why this works at all — do not put
 * PRAGMA statements in a migration, as those can't run inside a transaction.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ migrationsDir?: string, dataDir?: string }} [options]
 * @returns {{ applied: string[], backupPath: string | null }}
 */
function runMigrations(db, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name),
  );

  const files = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort()
    : [];

  const pending = files.filter((name) => !applied.has(name));
  if (pending.length === 0) return { applied: [], backupPath: null };

  // "Fresh" has to mean "no tables", NOT "no migrations recorded". The live
  // database predates this runner: it is full of real scores but its
  // schema_migrations table is empty, and judging by that would skip the
  // snapshot on exactly the database that most needs one.
  const { tables } = db
    .prepare(
      `SELECT COUNT(*) AS tables FROM sqlite_master
        WHERE type = 'table'
          AND name != 'schema_migrations'
          AND name NOT LIKE 'sqlite_%'`,
    )
    .get();

  const backupPath = tables === 0 ? null : snapshot(db, dataDir);

  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      record.run(name, Date.now());
    });

    try {
      apply();
    } catch (err) {
      throw new Error(`Migration ${name} failed: ${err.message}`, { cause: err });
    }
  }

  return { applied: pending, backupPath };
}

/**
 * Opens the database and brings the schema up to date. This is the one call
 * server.js makes at boot.
 *
 * @param {{ dataDir?: string, migrationsDir?: string, filename?: string }} [options]
 */
function initialize(options = {}) {
  const db = openDatabase(options);
  const result = runMigrations(db, options);
  return { db, ...result };
}

module.exports = { openDatabase, runMigrations, initialize };
