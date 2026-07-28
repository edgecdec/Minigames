import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import DoubleItGame from "@/games/double-it/DoubleItGame";
import { getGame } from "@/games/registry";

const meta = getGame("double-it")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function DoubleItPage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <DoubleItGame />
    </GameShell>
  );
}
