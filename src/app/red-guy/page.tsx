import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import RedGuyGame from "@/games/red-guy/RedGuyGame";
import { getGame } from "@/games/registry";

const meta = getGame("red-guy")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function RedGuyPage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <RedGuyGame />
    </GameShell>
  );
}
