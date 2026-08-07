"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GamePicker from "@/components/multiplayer/GamePicker";
import PlayerList from "@/components/multiplayer/PlayerList";
import RoomHeader from "@/components/multiplayer/RoomHeader";
import RoomJoin from "@/components/multiplayer/RoomJoin";
import PauseBanner from "@/components/multiplayer/PauseBanner";
import CodenamesRoom, { type CodenamesPublicState } from "@/games/codenames/CodenamesRoom";
import SnakeDuelRoom, { type DuelPublicState } from "@/games/snake-duel/SnakeDuelRoom";
import DoubleItDuelRoom, { type DuelPublicState as DoubleItDuelState } from "@/games/double-it-duel/DoubleItDuelRoom";
import { useRoom } from "@/lib/useRoom";
import { useLocalStorage } from "@/lib/useLocalStorage";

/**
 * The multiplayer shell: join a room, gather, host picks a game, play.
 *
 * Adding a multiplayer game means an entry in multiplayerRegistry.ts and one
 * case in renderGame() below — everything else here is game-agnostic.
 */
export default function Lobby() {
  // Reuse the leaderboard's remembered name so nobody types it twice.
  const [savedName, setSavedName] = useLocalStorage("minigames:playerName", "");
  const room = useRoom();

  /**
   * Room code from a shared link (/multiplayer?room=ABCD).
   *
   * Read once on mount rather than from a hook, because we deliberately strip it
   * from the URL straight afterwards: leaving it there means a refresh after
   * leaving would silently drag you back into the room you just left.
   */
  const [linkCode] = useState<string | null>(() => {
    // Lazy initialiser, so this runs during the FIRST render.
    //
    // Reading it in an effect was too late: RoomJoin had already mounted and
    // seeded its own state from the (still empty) initialCode prop, and useState
    // ignores later prop changes. An invitee with no saved name got a blank code
    // box and had to type the code by hand — defeating the link entirely.
    if (typeof window === "undefined") return null; // SSR pass
    const raw = new URLSearchParams(window.location.search).get("room");
    if (!raw) return null;
    const code = raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
    return code.length === 4 ? code : null;
  });

  // Strip the code from the URL once we have it, so a refresh after leaving
  // doesn't silently drag you back into the room. Done in an effect because
  // history is a side effect, and it must not run during render.
  useEffect(() => {
    if (!linkCode) return;
    if (!window.location.search.includes("room=")) return;
    window.history.replaceState({}, "", window.location.pathname);
  }, [linkCode]);

  /**
   * Auto-join only when we already know the player's name. A first-time visitor
   * following a link still needs the name box, so the code is prefilled instead
   * and they press Join.
   */
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current) return;
    if (!linkCode || !savedName.trim()) return;
    if (room.status !== "idle") return;
    autoJoined.current = true;
    room.join(linkCode, savedName.trim());
  }, [linkCode, savedName, room]);

  if (room.status === "idle" || room.status === "error" || !room.state) {
    return (
      <RoomJoin
        initialName={savedName}
        initialCode={linkCode ?? ""}
        connecting={room.status === "connecting"}
        error={room.error}
        onJoin={(code, name) => {
          setSavedName(name);
          room.join(code, name);
        }}
      />
    );
  }

  const { state } = room;

  function renderGame() {
    switch (state.game) {
      case "codenames":
        return (
          <CodenamesRoom
            state={state.gameState as CodenamesPublicState}
            players={state.players}
            userId={room.userId}
            isHost={room.isHost}
            send={room.send}
          />
        );
      case "snake-duel":
        return (
          <SnakeDuelRoom
            state={state.gameState as DuelPublicState}
            players={state.players}
            userId={room.userId}
            isHost={room.isHost}
            send={room.send}
          />
        );
      case "double-it-duel":
        return (
          <DoubleItDuelRoom
            state={state.gameState as DoubleItDuelState}
            players={state.players}
            userId={room.userId}
            isHost={room.isHost}
            send={room.send}
          />
        );
      default:
        return (
          <Alert severity="warning">
            This room is playing something this page doesn&apos;t know how to show.
          </Alert>
        );
    }
  }

  return (
    <Stack spacing={2.5} sx={{ width: "100%", alignItems: "center" }}>
      <RoomHeader
        roomCode={state.roomCode}
        connected={room.status === "joined"}
        onLeave={room.leave}
        onPause={room.pause}
        // Only offer Pause when there is actually a game to freeze, and only to
        // the host — the server enforces the same rule.
        canPause={room.isHost && !!state.game && !!state.gameState && !state.paused}
      />

      {room.error ? (
        <Alert severity="warning" onClose={room.clearError} sx={{ width: "100%" }}>
          {room.error}
        </Alert>
      ) : null}

      {state.paused ? (
        <PauseBanner
          paused={state.paused}
          players={state.players}
          isHost={room.isHost}
          onResume={room.resume}
        />
      ) : null}

      {state.game && state.gameState ? (
        renderGame()
      ) : (
        <Stack spacing={2.5} sx={{ width: "100%" }}>
          <GamePicker
            onSelect={room.selectGame}
            playerCount={state.players.filter((p) => p.connected).length}
            disabled={!room.isHost}
            currentSlug={state.game}
          />
          {!room.isHost ? (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
              Share the room code above to invite more people.
            </Typography>
          ) : null}
          <PlayerList players={state.players} userId={room.userId} />
        </Stack>
      )}
    </Stack>
  );
}
