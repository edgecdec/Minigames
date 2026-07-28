/**
 * Constants shared by the client and the API route.
 *
 * Deliberately free of both React and the database, so importing it from
 * either side pulls in nothing it shouldn't.
 */

export const SLUG = "perfect-pitch";

/**
 * The shared leaderboard column is an integer, but a run total is a float out
 * of 50 — and at the top of the board the decimals are the whole difference
 * between two players. Storing score x 100 keeps them: a perfect run is 5000.
 */
export const BOARD_SCALE = 100;

/** Turns a stored board value back into a run total. */
export function boardScoreToTotal(value: number): number {
  return value / BOARD_SCALE;
}
