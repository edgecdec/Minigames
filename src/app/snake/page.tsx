import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import SnakeGame from "@/games/snake/SnakeGame";
import { getGame } from "@/games/registry";

const meta = getGame("snake")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function SnakePage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <SnakeGame />
    </GameShell>
  );
}
