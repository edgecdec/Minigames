import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import Lobby from "@/components/multiplayer/Lobby";

export const metadata: Metadata = {
  title: "Multiplayer — Minigames",
  description: "Create a room, share the code, and play together.",
};

export default function MultiplayerPage() {
  return (
    <GameShell
      title="Multiplayer"
      icon="👥"
      controls="Create a room, share the code, pick a game"
    >
      <Lobby />
    </GameShell>
  );
}
