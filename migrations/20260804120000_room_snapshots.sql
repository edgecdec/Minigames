-- Snapshots of live multiplayer rooms, so a server restart doesn't destroy
-- every active lobby.
--
-- Rooms normally live only in process memory (see src/lib/rooms.js). A deploy
-- runs `pm2 restart`, which wipes them and leaves players staring at
-- "No room called ABCD" as though they had mistyped the code.
--
-- One row per room. The whole room — membership, host, game slug, game state —
-- is stored as a single JSON blob rather than normalised columns, on purpose:
-- every game has a different state shape, and a schema that tried to model all
-- of them would need a migration every time someone adds a game.
--
-- Rooms are always snapshotted PAUSED, which is what makes this tractable: a
-- paused game has no running timers and no partially-elapsed turn to
-- reconstruct.
CREATE TABLE IF NOT EXISTS room_snapshots (
  code        TEXT PRIMARY KEY,
  game_slug   TEXT,
  host_id     TEXT NOT NULL,
  -- JSON: { players: [...], state: {...}, paused: {...} }
  payload     TEXT NOT NULL,
  saved_at    INTEGER NOT NULL
);

-- Stale snapshots are swept on boot; this keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_room_snapshots_saved_at
  ON room_snapshots(saved_at);
