/**
 * Shared multiplayer room layer.
 *
 * CommonJS on purpose: server.js is plain Node and loads this directly, so it
 * must not go through the Next/webpack build.
 *
 * A room is created EMPTY, with no game chosen. Players gather, then the host
 * picks a game from the lobby. That ordering is why the game is a plugin here
 * rather than a property of the room code: one lobby can play Codenames, then
 * switch to something else without everyone re-joining.
 *
 * ---------------------------------------------------------------------------
 * SINGLE HOST, SINGLE PROCESS — load-bearing, not incidental.
 * ---------------------------------------------------------------------------
 * Rooms live in the Map below, in this process's memory. No Redis, no database
 * for live state — the same choice TopTenGame made.
 *
 * The consequence: the app MUST run as exactly one process. Under pm2 cluster
 * mode (or a second host behind a load balancer) two players typing the same
 * room code can land in different processes and each see a room of one, with no
 * error anywhere. Keep pm2 in fork mode.
 *
 * Moving to more than one instance means moving live state out of process
 * first — a real project, not a config flag.
 */

const crypto = require("crypto");

/** code -> room */
const rooms = new Map();

/**
 * Room codes a human can read aloud: no I/O/0/1, which get misheard and
 * mistyped constantly.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

const MAX_NAME = 16;
const MAX_ROOMS = 500;
/** An empty room lingers this long so a refresh doesn't destroy the game. */
const EMPTY_ROOM_GRACE_MS = 60_000;

/**
 * Characters that break a player list rather than merely look odd: control
 * chars, zero-width, bidi overrides (which can visually reorder other players'
 * rows), and combining marks. Written as escapes — literal control characters
 * in source are invisible and get mangled by copy-paste.
 */
const DISALLOWED_NAME_CHARS = new RegExp(
  "[" +
    "\\u0000-\\u001F\\u007F-\\u009F" +
    "\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F" +
    "\\uFEFF" +
    "\\u0300-\\u036F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20F0\\uFE20-\\uFE2F" +
    "]",
  "gu",
);

function generateRoomCode() {
  let code;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

/** Mirrors the 16-code-point rule the leaderboard enforces in names.ts. */
function cleanPlayerName(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const collapsed = raw
    .slice(0, MAX_NAME * 4)
    .replace(/[\t\n\r\v\f]/g, " ")
    .normalize("NFC")
    .replace(DISALLOWED_NAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = Array.from(collapsed).slice(0, MAX_NAME).join("").trim();
  return cleaned || fallback;
}

function parseCookie(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

/**
 * A game plugged into this layer.
 *
 * The room layer owns membership, host, codes, and broadcast. A game owns its
 * own state and never touches a socket — which is what lets Codenames, Snake
 * 1v1, and anything later share all of this.
 *
 *   createState(room)            -> initial game state
 *   publicState(room, state)     -> what clients may see
 *   onEvent(ctx, event, payload) -> mutate state; return false to skip broadcast
 *   onPlayerLeave?(ctx, userId)  -> optional cleanup
 *   minPlayers?                  -> guard before the host can start
 *
 * Pause hooks. A game only needs these if it runs a timer or derives anything
 * from wall-clock time:
 *
 *   onPause?(ctx)                -> stop timers; bank any elapsed time
 *   onResume?(ctx)               -> restart timers; re-base any timestamps
 *
 * The room layer owns WHEN a game is paused; the game owns what freezing means
 * for its own state. Codenames needs neither hook — it has no clock.
 */
const games = new Map();

function registerGame(slug, handlers) {
  if (!handlers || typeof handlers.createState !== "function") {
    throw new Error(`registerGame(${slug}): createState is required`);
  }
  games.set(slug, handlers);
}

function listGames() {
  return Array.from(games.keys());
}

function createRoom(code, hostId) {
  const room = {
    code,
    hostId,
    /**
     * Set while the game is frozen. Holds who paused it and why, so the client
     * can say "paused by Ana" versus "server restarting".
     *
     * Pause is a first-class room concept rather than per-game because the
     * restart path needs to freeze EVERY room regardless of what it's playing.
     */
    paused: null,
    players: new Map(),
    /** null until the host picks one. */
    gameSlug: null,
    state: null,
    createdAt: Date.now(),
    emptySince: null,
  };
  rooms.set(code, room);
  return room;
}

/** Membership plus whatever the chosen game chose to expose. */
function publicState(room) {
  const handlers = room.gameSlug ? games.get(room.gameSlug) : null;
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostId,
    connected: p.connected,
  }));
  return {
    roomCode: room.code,
    hostId: room.hostId,
    game: room.gameSlug,
    paused: room.paused,
    players,
    gameState:
      handlers && room.state
        ? handlers.publicState
          ? handlers.publicState(room, room.state)
          : room.state
        : null,
  };
}

function broadcast(io, room) {
  io.to(room.code).emit("room_state", publicState(room));
}

/** Reap rooms whose players have all been gone past the grace period. */
function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (anyConnected) {
      room.emptySince = null;
      continue;
    }
    if (room.emptySince === null) {
      room.emptySince = now;
    } else if (now - room.emptySince > EMPTY_ROOM_GRACE_MS) {
      if (room.state && room.state.timer) clearTimeout(room.state.timer);
      rooms.delete(code);
    }
  }
}

/**
 * Freeze a room's game. Idempotent, so the restart sweep can call it over a
 * room the host already paused.
 *
 * `by` is a userId for a manual pause, or null when the server did it.
 */
function pauseRoom(room, { by = null, reason = "host" } = {}, io = null) {
  if (!room.gameSlug || !room.state) return false;
  if (room.paused) return false;

  room.paused = { by, reason, at: Date.now() };
  const handlers = games.get(room.gameSlug);
  if (handlers && typeof handlers.onPause === "function") {
    try {
      handlers.onPause(pauseCtx(room, io));
    } catch (err) {
      console.error(`[rooms] ${room.gameSlug} onPause failed:`, err);
    }
  }
  return true;
}

/** Thaw a room. The game re-bases its own clocks in onResume. */
function resumeRoom(room, io = null) {
  if (!room.paused) return false;
  room.paused = null;
  const handlers = games.get(room.gameSlug);
  if (handlers && typeof handlers.onResume === "function") {
    try {
      handlers.onResume(pauseCtx(room, io));
    } catch (err) {
      console.error(`[rooms] ${room.gameSlug} onResume failed:`, err);
    }
  }
  return true;
}

/**
 * A ctx for the pause hooks. Deliberately has no `userId` — pause can be driven
 * by the server with no socket behind it, so a hook must not assume one.
 */
function pauseCtx(room, io) {
  return {
    room,
    state: room.state,
    setState(next) {
      room.state = next;
    },
    broadcast() {
      if (io) broadcast(io, room);
    },
    emitToPlayer() {
      // No socket in this path; a hook trying to reply to "the caller" is a bug.
    },
  };
}

/**
 * Wire socket.io up to the room layer.
 * `verifyIdentity(cookieHeader)` returns a stable user id, or null.
 */
function attach(io, { verifyIdentity }) {
  const sweeper = setInterval(sweepRooms, 30_000);
  if (sweeper.unref) sweeper.unref();

  io.on("connection", (socket) => {
    let currentCode = null;
    let userId = null;
    /**
     * Fallback id for a visitor with no signed cookie, minted ONCE per socket.
     *
     * Generating it per join_room instead would give the same browser a new
     * identity every time it re-joins — including the automatic re-join after a
     * reconnect — so one person would appear as several players and the room
     * would wait forever on submissions from people who don't exist.
     */
    const anonId = `anon-${crypto.randomUUID()}`;

    function ctx(room) {
      return {
        room,
        state: room.state,
        userId,
        isHost: room.hostId === userId,
        setState(next) {
          room.state = next;
        },
        broadcast() {
          broadcast(io, room);
        },
        emitToPlayer(event, payload) {
          socket.emit(event, payload);
        },
      };
    }

    socket.on("join_room", (payload) => {
      const { roomCode, name } = payload || {};

      // Identity comes from the signed cookie sent with the handshake. A
      // client-supplied id is never trusted — that would let anyone claim the
      // host seat and start or skip rounds.
      const verified = verifyIdentity(socket.request.headers.cookie);
      userId = verified || anonId;

      let code =
        typeof roomCode === "string" && roomCode.trim()
          ? roomCode.trim().toUpperCase()
          : "NEW";

      if (code === "NEW") {
        if (rooms.size >= MAX_ROOMS) {
          return socket.emit("room_error", { message: "Server is full — try again shortly" });
        }
        code = generateRoomCode();
        createRoom(code, userId);
      } else if (!rooms.has(code)) {
        return socket.emit("room_error", { message: `No room called ${code}`, code: "NOT_FOUND" });
      }

      const room = rooms.get(code);
      currentCode = code;
      socket.join(code);
      room.emptySince = null;

      const existing = room.players.get(userId);
      if (existing) {
        // Reconnect: keep their seat.
        existing.connected = true;
        existing.name = cleanPlayerName(name, existing.name);
      } else {
        room.players.set(userId, {
          id: userId,
          name: cleanPlayerName(name, `Player ${userId.slice(0, 4)}`),
          connected: true,
        });
      }

      // The host seat can be vacant after everyone dropped; first back takes it.
      if (!room.players.has(room.hostId)) room.hostId = userId;

      socket.emit("joined", { roomCode: code, userId, isHost: room.hostId === userId });
      broadcast(io, room);
    });

    /** Host picks (or changes) the game. Resets game state. */
    socket.on("select_game", (payload) => {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      if (!room) return;
      if (room.hostId !== userId) {
        return socket.emit("room_error", { message: "Only the host can choose the game" });
      }
      const { game } = payload || {};
      if (typeof game !== "string" || !games.has(game)) {
        return socket.emit("room_error", { message: "Unknown game" });
      }
      if (room.state && room.state.timer) clearTimeout(room.state.timer);
      room.gameSlug = game;
      room.state = games.get(game).createState(room);
      broadcast(io, room);
    });

    socket.on("game_event", (payload) => {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      if (!room || !room.gameSlug) return;
      const handlers = games.get(room.gameSlug);
      if (!handlers || typeof handlers.onEvent !== "function") return;

      const { event, data } = payload || {};
      if (typeof event !== "string") return;

      // A paused game accepts nothing. Without this the freeze is cosmetic: in
      // Double It Duel you could keep answering while no clock was running.
      if (room.paused) {
        socket.emit("room_error", { message: "The game is paused" });
        return;
      }

      try {
        // A game throwing must not kill the connection for everyone else.
        const changed = handlers.onEvent(ctx(room), event, data);
        if (changed !== false) broadcast(io, room);
      } catch (err) {
        console.error(`[rooms] ${room.gameSlug} event "${event}" failed:`, err);
        socket.emit("room_error", { message: "Something went wrong" });
      }
    });

    /** Host-only. Freezes the game for everyone until they resume it. */
    socket.on("pause_game", () => {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      if (!room) return;
      if (room.hostId !== userId) {
        return socket.emit("room_error", { message: "Only the host can pause" });
      }
      if (!room.gameSlug || !room.state) return;
      if (pauseRoom(room, { by: userId, reason: "host" }, io)) broadcast(io, room);
    });

    socket.on("resume_game", () => {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      if (!room) return;
      if (room.hostId !== userId) {
        return socket.emit("room_error", { message: "Only the host can resume" });
      }
      if (resumeRoom(room, io)) broadcast(io, room);
    });

    socket.on("set_name", (payload) => {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      if (!room) return;
      const player = room.players.get(userId);
      if (!player) return;
      player.name = cleanPlayerName(payload && payload.name, player.name);
      broadcast(io, room);
    });

    socket.on("leave_room", () => handleDeparture(true));
    socket.on("disconnect", () => handleDeparture(false));

    function handleDeparture(explicit) {
      if (!currentCode || !userId) return;
      const room = rooms.get(currentCode);
      const code = currentCode;
      currentCode = null;
      if (!room) return;

      const player = room.players.get(userId);
      if (player) {
        if (explicit) {
          // Leaving on purpose gives up the seat; a dropped connection keeps it
          // so a refresh or a network blip doesn't lose your game.
          room.players.delete(userId);
        } else {
          player.connected = false;
        }
      }

      if (room.hostId === userId) {
        const nextHost = Array.from(room.players.values()).find(
          (p) => p.connected && p.id !== userId,
        );
        if (nextHost) room.hostId = nextHost.id;
      }

      if (room.gameSlug) {
        const handlers = games.get(room.gameSlug);
        if (handlers && typeof handlers.onPlayerLeave === "function") {
          try {
            handlers.onPlayerLeave(ctx(room), userId);
          } catch (err) {
            console.error(`[rooms] ${room.gameSlug} onPlayerLeave failed:`, err);
          }
        }
      }

      socket.leave(code);
      if (room.players.size > 0) broadcast(io, room);
    }
  });
}

module.exports = {
  attach,
  pauseRoom,
  resumeRoom,
  registerGame,
  listGames,
  rooms,
  generateRoomCode,
  cleanPlayerName,
  parseCookie,
  publicState,
  sweepRooms,
  CODE_ALPHABET,
  CODE_LENGTH,
  EMPTY_ROOM_GRACE_MS,
  MAX_ROOMS,
};
