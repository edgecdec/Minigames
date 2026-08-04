/**
 * The one place a multiplayer game gets registered.
 *
 * Separate from GAMES in registry.ts because these do not own a route: they all
 * live inside a lobby at /multiplayer, and the host picks one from this list
 * after players have gathered.
 *
 * Adding one:
 *   1. src/games/<slug>/logic.ts        — pure rules, tested without a browser
 *   2. src/games/<slug>/server.js       — room handlers (CommonJS; server.js
 *                                        loads it outside the webpack build)
 *   3. src/games/<slug>/<Name>Room.tsx  — the in-lobby view
 *   4. an entry here, and registerGame() in server.js
 */

export interface MultiplayerGameMeta {
  /** Must match the slug used in registerGame() on the server. */
  slug: string;
  title: string;
  blurb: string;
  icon: string;
  minPlayers: number;
  /** Shown on the lobby card so a host knows what they're picking. */
  howToPlay: string;
  status: "live" | "wip";
}

export const MULTIPLAYER_GAMES: MultiplayerGameMeta[] = [
  {
    slug: "codenames",
    title: "Codenames But It's Actually Fun",
    blurb: "One word per player on screen. Narrow them down to a single word.",
    icon: "🧠",
    minPlayers: 2,
    howToPlay:
      "The prompt starts with one word per player. Everyone secretly submits the single " +
      "word that connects them all. Every different answer becomes the next prompt, so " +
      "agreement shrinks the board: 4 words, then 3, then 2, then everyone says the same " +
      "word and you win. No word can be used twice.",
    status: "live",
  },
  {
    slug: "snake-duel",
    title: "Snake Free-for-All",
    blurb: "Up to 8 snakes, random spawns, last one alive wins.",
    icon: "🐍",
    minPlayers: 2,
    howToPlay:
      "Everyone spawns somewhere random with a few seconds of spawn protection, then " +
      "it's last-snake-standing. All snakes move on the same server tick. Eat to grow, " +
      "and make the others crash into a wall, themselves, or you. Walls still kill " +
      "during protection.",
    status: "live",
  },
  {
    slug: "double-it-duel",
    title: "Double It Duel",
    blurb: "Multiplication under a shared clock. Take too long and you fund everyone else.",
    icon: "⏳",
    minPlayers: 2,
    howToPlay:
      "Everyone starts with the same clock, but only the player on turn is losing time. " +
      "Answer correctly and the time you took — minus the amount that falls into the abyss — " +
      "is split among everyone else. Overflow above the starting clock is allowed, so answering " +
      "fast banks a real cushion. Run out of time or answer wrong and you're out. The host sets " +
      "the multiplier, the starting clock, and the abyss.",
    status: "live",
  },
];

export function getMultiplayerGame(slug: string): MultiplayerGameMeta | undefined {
  return MULTIPLAYER_GAMES.find((g) => g.slug === slug);
}
