/**
 * The one place a new game gets registered.
 *
 * Adding a game:
 *   1. create src/app/<slug>/page.tsx
 *   2. add an entry here
 * The menu, routing, and nav all read from this list.
 */

export type GameStatus = "live" | "wip";

export interface GameMeta {
  /** URL segment — must match the folder under src/app/ */
  slug: string;
  title: string;
  /** One line shown on the menu tile. */
  blurb: string;
  /** Emoji used as the tile icon. Keeps us off an icon dependency for now. */
  icon: string;
  /** How you play, shown in the game's own header. */
  controls: string;
  status: GameStatus;
}

export const GAMES: GameMeta[] = [
  {
    slug: "lets-get-high",
    title: "Let's Get High",
    blurb: "Name a number. Lilian names a higher one. Keep climbing forever.",
    icon: "🚀",
    controls: "Type a positive whole number, Enter to submit",
    status: "live",
  },
  {
    slug: "snake",
    title: "Snake",
    blurb: "Grid-locked classic. Eat, grow, don't bite yourself.",
    icon: "🐍",
    controls: "Arrow keys, WASD, or swipe",
    status: "live",
  },
  {
    slug: "coin-flippers",
    title: "Coin Flippers",
    blurb: "Flip heads ten times in a row. Simple. Cruel.",
    icon: "🪙",
    controls: "Click, Space, or Enter to flip",
    status: "live",
  },
  {
    slug: "double-it",
    title: "Double It!",
    blurb: "Double the number before the clock runs out. It keeps getting shorter.",
    icon: "✖️",
    controls: "Type the answer, Enter to submit",
    status: "live",
  },
  {
    slug: "rngdle",
    title: "RNGdle",
    blurb: "Ten rolls a day, same for everyone. Chase the golden pull.",
    icon: "🎲",
    controls: "Click to roll",
    status: "live",
  },
  {
    slug: "bobs-big-number",
    title: "Bob's Big Number",
    blurb: "Guess Bob the Monkey's number from 1 to 1 Sextillion in 70 decreasing levels.",
    icon: "🐵",
    controls: "Type a guess or use Split Difference for binary search",
    status: "live",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}
