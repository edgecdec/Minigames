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
    blurb: "Two words. Everyone guesses the word that bridges them. Match to win.",
    icon: "🧠",
    minPlayers: 2,
    howToPlay:
      "You all see the same two words and secretly submit the one word connecting them. " +
      "Match and you win. Miss, and your two words become the new pair — so a bad guess " +
      "still moves you forward. Words already used can't be used again.",
    status: "live",
  },
];

export function getMultiplayerGame(slug: string): MultiplayerGameMeta | undefined {
  return MULTIPLAYER_GAMES.find((g) => g.slug === slug);
}
