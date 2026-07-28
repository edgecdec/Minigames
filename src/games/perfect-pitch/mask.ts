/**
 * Masking for the one number the client isn't supposed to read.
 *
 * The browser has to be told what frequency to play — you cannot make a sound
 * otherwise — so the target can never be truly hidden. What it does not have
 * to be is *labelled*. Before this, `{"targetHz": 415.3}` sat in the network
 * tab of a game whose entire challenge is guessing that number.
 *
 * So the target ships as a masked integer alongside a per-round salt and three
 * decoys that look exactly like it. Recovering it means reading the client
 * code to find this function, rather than opening devtools and looking.
 *
 * This is obfuscation, not security, and the distinction matters: anyone who
 * hooks AudioParam.setValueAtTime gets the frequency without touching any of
 * it. It raises the floor so the answer isn't lying in plain sight; the things
 * that actually defend the leaderboard are server-side scoring and the
 * plausibility checks in trajectory.ts.
 *
 * Pure and dependency-free so the server and the client run identical code.
 */

/** Cents are stored to three decimals — comfortably inside a uint32. */
const CENTS_SCALE = 1000;

/** Decoys per round. Enough that no single number stands out. */
export const DECOY_COUNT = 3;

/**
 * FNV-1a, then an avalanche mix.
 *
 * Deliberately not SubtleCrypto: that's async and needs a secure context,
 * which would make the audio path await a promise and break on plain http.
 * The mask doesn't need to resist cryptanalysis — it needs to not be readable.
 */
export function roundKey(runId: string, salt: string, index: number): number {
  let hash = 0x811c9dc5;
  const material = `${runId}:${salt}:${index}`;

  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    // FNV prime, via shifts so it stays in 32-bit integer arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;

  return hash >>> 0;
}

export function maskCents(cents: number, key: number): number {
  return ((Math.round(cents * CENTS_SCALE) ^ key) >>> 0);
}

export function unmaskCents(masked: number, key: number): number {
  return ((masked ^ key) >>> 0) / CENTS_SCALE;
}

/** What actually goes over the wire for a round. Terse on purpose. */
export interface MaskedRound {
  /** Round index, 0-based. */
  i: number;
  /** Per-round salt. */
  s: string;
  /** The masked target, hiding among `n`. */
  m: number;
  /** Decoys, indistinguishable from `m` without the key. */
  n: number[];
  /** Starting ribbon position. Not secret — the player sees it immediately. */
  sc: number;
}
