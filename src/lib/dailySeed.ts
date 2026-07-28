/**
 * Deterministic daily seeds for "-dle" style games.
 *
 * Everyone gets the same puzzle on the same calendar day with no server: the
 * seed is derived from the local date string, so it needs no DB and no clock
 * sync. Shared so every future -dle game uses the same mechanism.
 */

/** Local calendar day as YYYY-MM-DD (local, so the day flips at the player's midnight). */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** FNV-1a — small, fast, and stable across browsers (unlike hashing via Math.random). */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 PRNG. Same seed always yields the same sequence, so a daily
 * puzzle can be regenerated on demand instead of stored.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG for a given game on a given day. */
export function dailyRng(gameSlug: string, dayKey: string = todayKey()): () => number {
  return seededRng(hashString(`${gameSlug}:${dayKey}`));
}

/** Milliseconds until local midnight — for "next puzzle in ..." countdowns. */
export function msUntilTomorrow(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}
