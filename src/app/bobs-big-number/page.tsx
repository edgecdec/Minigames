import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import BobsBigNumberGame from "@/games/bobs-big-number/BobsBigNumberGame";
import { getGame } from "@/games/registry";

const meta = getGame("bobs-big-number")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function BobsBigNumberPage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <BobsBigNumberGame />
    </GameShell>
  );
}
