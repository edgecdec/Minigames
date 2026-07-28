import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import PerfectPitchGame from "@/games/perfect-pitch/PerfectPitchGame";
import { getGame } from "@/games/registry";

const meta = getGame("perfect-pitch")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function PerfectPitchPage() {
  return (
    <GameShell
      title={meta.title}
      icon={meta.icon}
      controls={meta.controls}
      maxWidth="md"
    >
      <PerfectPitchGame />
    </GameShell>
  );
}
