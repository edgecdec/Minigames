/**
 * The one place a new game gets registered.
 *
 * Adding a game:
 *   1. create src/app/<slug>/page.tsx
 *   2. add an entry here
 * The menu, routing, and nav all read from this list.
 */

import { MULTIPLIERS, boardSlug } from "./double-it/logic";

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
  /**
   * This game scores its own runs on the server and owns its submit endpoint.
   *
   * The shared /api/leaderboard POST refuses these outright — otherwise the
   * generic "here is my score, please believe me" path would sit alongside the
   * authoritative one and quietly undo it.
   */
  serverScored?: boolean;
  /**
   * Extra leaderboard keys this game owns beyond its own slug — for games with
   * per-mode boards (e.g. Double It! keeps a separate board per multiplier).
   *
   * The shared leaderboard API validates every submission against a known slug,
   * so a mode board must be listed here or the API rejects it. That's the point:
   * it keeps board keys to a fixed, server-known set rather than letting a client
   * invent `double-it:9999x` and spawn junk boards.
   */
  boardVariants?: string[];
}

/**
 * Resolve a board slug — a game's own slug OR one of its variants — to the game
 * that owns it. Returns undefined for an unknown slug, so callers get one place
 * to both validate a board key and reach the owning game's flags.
 */
export function getGameForBoard(slug: string): GameMeta | undefined {
  return GAMES.find(
    (g) => g.slug === slug || (g.boardVariants ?? []).includes(slug),
  );
}

export const GAMES: GameMeta[] = [
  {
    slug: "red-guy",
    title: "Red Guy Counter",
    blurb: "Watch Red Guy's YouTube subscriber count climb in real time.",
    icon: "🔴",
    controls: "Just watch — updates automatically",
    status: "live",
  },
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
    blurb: "Multiply the number before the clock runs out. ×2 up to ×9.",
    icon: "✖️",
    controls: "Pick a multiplier, then type the answer",
    status: "live",
    // One board per multiplier: ×9 is a far harder game than ×2.
    boardVariants: MULTIPLIERS.map(boardSlug),
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
    slug: "perfect-pitch",
    title: "Perfect Pitch",
    blurb: "Hear a tone once, then hunt it down across three octaves. Headphones help.",
    icon: "🎧",
    controls: "Drag the ribbon, arrow keys to nudge, Enter to lock in",
    status: "live",
    serverScored: true,
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
