/**
 * Save and restore live multiplayer rooms across a server restart.
 *
 * CommonJS: server.js and rooms.js are plain Node, outside the webpack build.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Rooms live in an in-process Map. A deploy runs `pm2 restart`, which wipes it,
 * and the client's auto-rejoin then gets "No room called ABCD" — indistinguishable
 * from mistyping the code. Every deploy silently killed every active lobby.
 *
 * ---------------------------------------------------------------------------
 * WHY ROOMS ARE SAVED PAUSED
 * ---------------------------------------------------------------------------
 * A running game holds things that cannot be serialised or meaningfully restored:
 * setInterval handles, and clocks derived from wall-clock timestamps. Snapshotting
 * mid-turn would mean the active player's clock kept draining across an outage
 * they had no control over.
 *
 * Pausing first removes both problems. A paused game has no timers and no
 * partially-elapsed turn, so the snapshot is plain data and the restore is a
 * plain load. The host resumes when everyone is actually back.
 */

const { openDatabase } = require("./migrate.js");

/**
 * Snapshots older than this are dropped on boot rather than restored.
 *
 * A room nobody returns to is worse than no room: it holds a code, shows stale
 * players, and can never be resumed. An hour is long enough to cover a deploy
 * or a crash-and-restart, short enough that yesterday's games don't come back.
 */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

function table(db) {
  // Tolerate the table not existing yet — a failed migration must not stop the
  // site from serving, matching how server.js treats migrations generally.
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_snapshots'",
    )
    .get();
  return !!row;
}

/**
 * Serialise one room.
 *
 * Deliberately a projection, not JSON.stringify(room): `players` is a Map, and
 * `state.timer` is an interval handle that would either throw or serialise to
 * something meaningless. Anything not listed here is intentionally dropped.
 */
function serializeRoom(room) {
  const { timer, ...stateWithoutTimer } = room.state || {};
  void timer; // dropped on purpose — a handle can't survive a restart
  return {
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      // Everyone comes back disconnected; their sockets are gone. Reconnects
      // flip this true, so the UI shows who has actually returned.
      connected: false,
    })),
    state: room.state ? stateWithoutTimer : null,
    paused: room.paused,
  };
}

/**
 * Persist every room that has a game in progress.
 *
 * Lobby-only rooms are skipped: there is no game to lose, and restoring an empty
 * room just resurrects a code nobody is using.
 */
function saveRooms(rooms, dbOptions = {}) {
  let db;
  try {
    // openDatabase takes { dataDir, filename } — pass it straight through so a
    // test can point this at a scratch database.
    db = openDatabase(dbOptions);
  } catch (err) {
    console.error("[rooms] could not open the database to save rooms:", err.message);
    return { saved: 0 };
  }

  try {
    if (!table(db)) {
      console.warn("[rooms] room_snapshots table is missing; not saving rooms");
      return { saved: 0 };
    }

    const now = Date.now();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO room_snapshots (code, game_slug, host_id, payload, saved_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // One transaction: a half-written set of rooms is worse than none, because
    // some players would come back to a room their friends can't see.
    const run = db.transaction((entries) => {
      db.prepare("DELETE FROM room_snapshots").run();
      for (const [code, room] of entries) {
        insert.run(
          code,
          room.gameSlug,
          room.hostId,
          JSON.stringify(serializeRoom(room)),
          now,
        );
      }
    });

    const worth = Array.from(rooms.entries()).filter(
      ([, room]) => room.gameSlug && room.state,
    );
    run(worth);
    return { saved: worth.length };
  } catch (err) {
    console.error("[rooms] failed to save rooms:", err.message);
    return { saved: 0 };
  } finally {
    try {
      db.close();
    } catch {
      // Already closed, or never opened cleanly.
    }
  }
}

/**
 * Restore rooms into the live Map, always paused.
 *
 * `createRoom` is passed in rather than imported to avoid a require cycle with
 * rooms.js, which already loads this module.
 */
function loadRooms(rooms, createRoom, dbOptions = {}) {
  let db;
  try {
    db = openDatabase(dbOptions);
  } catch (err) {
    console.error("[rooms] could not open the database to load rooms:", err.message);
    return { restored: 0, dropped: 0 };
  }

  try {
    if (!table(db)) return { restored: 0, dropped: 0 };

    const rows = db
      .prepare("SELECT code, game_slug, host_id, payload, saved_at FROM room_snapshots")
      .all();

    const now = Date.now();
    let restored = 0;
    let dropped = 0;

    for (const row of rows) {
      if (now - row.saved_at > MAX_SNAPSHOT_AGE_MS) {
        dropped++;
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        // A corrupt row must not stop the others from coming back.
        dropped++;
        continue;
      }

      const room = createRoom(row.code, row.host_id);
      // Marks this room for the longer sweep grace period: everyone is
      // disconnected right now, and the normal 60s window would delete it before
      // they finish coming back.
      room.restored = true;
      room.gameSlug = row.game_slug;
      room.state = payload.state;
      // ALWAYS paused, whatever the snapshot said. A room restored mid-turn with
      // its timers gone would have a clock that never ticks and a turn nobody
      // can end.
      room.paused = payload.paused || {
        by: null,
        reason: "restart",
        at: now,
      };
      (payload.players || []).forEach((p) => {
        room.players.set(p.id, { id: p.id, name: p.name, connected: false });
      });
      restored++;
    }

    // Snapshots are single-use: leaving them behind would resurrect the same
    // rooms after the next restart, on top of whatever is live by then.
    db.prepare("DELETE FROM room_snapshots").run();
    return { restored, dropped };
  } catch (err) {
    console.error("[rooms] failed to load rooms:", err.message);
    return { restored: 0, dropped: 0 };
  } finally {
    try {
      db.close();
    } catch {
      // Already closed.
    }
  }
}

module.exports = { saveRooms, loadRooms, serializeRoom, MAX_SNAPSHOT_AGE_MS };
