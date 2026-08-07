"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

/**
 * What every multiplayer game component receives.
 *
 * Shared so a new game gets the full set — including `roomWins`, which three
 * separate rooms each had to be told about individually before this existed.
 * `TState` is the game's own publicState shape.
 */
export interface RoomGameProps<TState> {
  state: TState;
  players: RoomPlayer[];
  userId: string;
  isHost: boolean;
  send: (event: string, data?: unknown) => void;
  /** Session wins across every game played in this room, keyed by userId. */
  roomWins?: Record<string, number>;
}

export interface RoomPaused {
  /** userId who paused it, or null when the server did. */
  by: string | null;
  reason: "host" | "restart" | string;
  at: number;
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  /** Wins across every game played in this room, keyed by userId. */
  roomWins: Record<string, number>;
  /** Non-null while the game is frozen. */
  paused: RoomPaused | null;
  /** null while the lobby hasn't chosen a game yet. */
  game: string | null;
  players: RoomPlayer[];
  /** Whatever the chosen game exposed. Shape is game-specific. */
  gameState: unknown;
}

export type RoomStatus = "idle" | "connecting" | "joined" | "error";

/**
 * Shared client for the multiplayer room layer.
 *
 * One socket per lobby, and every game inside the lobby talks through it — so a
 * new multiplayer game needs no networking code of its own, only `send()` and a
 * read of `state.gameState`.
 */
export function useRoom() {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const socketRef = useRef<Socket | null>(null);

  // Remembered so a reconnect can re-join without asking again.
  const lastJoin = useRef<{ roomCode: string; name: string } | null>(null);
  // Distinguishes the first connect (join() emits) from a reconnect (we do).
  const hasJoinedOnce = useRef(false);

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;

    const s = io({
      // Send the identity cookie with the handshake so the server can tie this
      // socket to the same player the leaderboard knows.
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      // Re-join automatically after a DROP only. On the very first connect,
      // join() does the emitting — doing both would send join_room twice, and a
      // visitor with no identity cookie would be seated as two players.
      if (lastJoin.current && hasJoinedOnce.current) {
        s.emit("join_room", lastJoin.current);
      }
    });
    s.on("disconnect", () => setStatus((cur) => (cur === "joined" ? "connecting" : cur)));
    s.on("joined", (payload: { roomCode: string; userId: string }) => {
      hasJoinedOnce.current = true;
      setUserId(payload.userId);
      setStatus("joined");
      setError(null);
    });
    s.on("room_state", (next: RoomState) => setState(next));
    s.on("room_error", (payload: { message?: string }) => {
      setError(payload?.message ?? "Something went wrong");
      // A bad code shouldn't leave us stuck on a spinner forever.
      setStatus((cur) => (cur === "connecting" ? "error" : cur));
    });
    s.on("connect_error", () => {
      setError("Can't reach the server");
      setStatus("error");
    });

    socketRef.current = s;
    return s;
  }, []);

  useEffect(
    () => () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    },
    [],
  );

  /** `roomCode` omitted or "NEW" creates a fresh room. */
  const join = useCallback(
    async (roomCode: string, name: string) => {
      const payload = { roomCode: roomCode || "NEW", name };
      lastJoin.current = payload;
      setStatus("connecting");
      setError(null);

      // Make sure this browser holds a durable signed id BEFORE the socket opens.
      // A websocket handshake can't set a cookie, so without this a visitor who
      // never submitted a score got a per-socket throwaway id — and opening the
      // invite link twice in one browser seated them as two separate players.
      try {
        await fetch("/api/identity", { method: "POST" });
      } catch {
        // Not fatal: they can still play, just as a throwaway identity. Better
        // than refusing to join because one request failed.
      }

      ensureSocket().emit("join_room", payload);
    },
    [ensureSocket],
  );

  const leave = useCallback(() => {
    socketRef.current?.emit("leave_room");
    socketRef.current?.disconnect();
    socketRef.current = null;
    lastJoin.current = null;
    hasJoinedOnce.current = false;
    setState(null);
    setStatus("idle");
    setError(null);
  }, []);

  const selectGame = useCallback((game: string) => {
    socketRef.current?.emit("select_game", { game });
  }, []);

  /**
   * Host-only: drop the current game and go back to the picker, keeping the room
   * and everyone in it. Distinct from leave(), which removes you entirely.
   */
  const backToLobby = useCallback(() => {
    socketRef.current?.emit("back_to_lobby");
  }, []);

  /** Host-only; the server enforces that too. */
  const pause = useCallback(() => {
    socketRef.current?.emit("pause_game");
  }, []);

  const resume = useCallback(() => {
    socketRef.current?.emit("resume_game");
  }, []);

  /** Send a game-specific event. */
  const send = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit("game_event", { event, data });
  }, []);

  const setName = useCallback((name: string) => {
    socketRef.current?.emit("set_name", { name });
  }, []);

  const me = state?.players.find((p) => p.id === userId) ?? null;

  return {
    state,
    status,
    error,
    userId,
    me,
    isHost: !!me?.isHost,
    join,
    leave,
    selectGame,
    backToLobby,
    pause,
    resume,
    send,
    setName,
    clearError: () => setError(null),
  };
}
