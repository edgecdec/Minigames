"use client";

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

  if (room.status === "idle" || room.status === "error" || !room.state) {
    return (
      <RoomJoin
        initialName={savedName}
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
