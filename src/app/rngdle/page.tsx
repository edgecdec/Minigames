import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import RngdleGame from "@/games/rngdle/RngdleGame";
import { getGame } from "@/games/registry";

const meta = getGame("rngdle")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function RngdlePage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <RngdleGame />
    </GameShell>
  );
}
