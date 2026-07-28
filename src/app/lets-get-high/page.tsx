import GameShell from "@/components/GameShell";
import LetsGetHighGame from "@/games/lets-get-high/LetsGetHighGame";

export const metadata = { title: "Let's Get High | Minigames" };

export default function LetsGetHighPage() {
  return <GameShell title="Let's Get High" icon="🚀" controls="Type a number, then go higher"><LetsGetHighGame /></GameShell>;
}
