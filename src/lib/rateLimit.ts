/**
 * In-memory sliding-window rate limit.
 *
 * Per-process and lost on restart, which is fine for one pm2 instance — its job
 * is to stop a loop or a bored script from writing thousands of rows, not to be
 * a distributed quota system.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
/** Bound the map so tracking keys can't itself become a memory leak. */
const MAX_KEYS = 5_000;

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max = MAX_PER_WINDOW,
  windowMs = WINDOW_MS,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    const oldest = recent[0];
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  if (hits.size > MAX_KEYS) {
    // Drop keys whose windows have fully expired; if that isn't enough, clear.
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    if (hits.size > MAX_KEYS) hits.clear();
  }

  return { ok: true, retryAfterSec: 0 };
}
