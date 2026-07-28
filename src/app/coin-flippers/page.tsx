import type { Metadata } from "next";
import GameShell from "@/components/GameShell";
import CoinFlippersGame from "@/games/coin-flippers/CoinFlippersGame";
import { getGame } from "@/games/registry";

const meta = getGame("coin-flippers")!;

export const metadata: Metadata = {
  title: `${meta.title} — Minigames`,
  description: meta.blurb,
};

export default function CoinFlippersPage() {
  return (
    <GameShell title={meta.title} icon={meta.icon} controls={meta.controls}>
      <CoinFlippersGame />
    </GameShell>
  );
}
