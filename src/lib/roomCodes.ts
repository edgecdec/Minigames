/**
 * Room-code constants for the client.
 *
 * Duplicated from src/lib/rooms.js on purpose: that file is CommonJS loaded by
 * server.js outside the webpack build, and importing it from a client component
 * would drag Node-only code into the bundle. Keep the two in sync — rooms.js is
 * the source of truth, since it does the generating.
 */

/** No I/O/0/1: those get misheard on a call and mistyped constantly. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

export function looksLikeRoomCode(value: string): boolean {
  if (value.length !== CODE_LENGTH) return false;
  return Array.from(value.toUpperCase()).every((c) => CODE_ALPHABET.includes(c));
}
