"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * localStorage-backed state, safe for SSR.
 *
 * Always renders `initial` on the server and on the first client paint, then
 * swaps in the stored value after mount. Reading localStorage during render
 * would hydration-mismatch, since the server has no access to it.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (value: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  // `initial` is often an inline literal ({} or []), so a new reference every
  // render. Snapshot it to keep it out of the effect's dependencies.
  const initialRef = useRef(initial);

  useEffect(() => {
    let next = initialRef.current;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) next = JSON.parse(raw) as T;
    } catch {
      // Private mode, quota, or corrupt JSON — fall back to `initial`.
    }
    // ALWAYS assign, even when the key holds nothing.
    //
    // Leaving the old value in place when the key changes leaks one key's data
    // into another: Double It keys its board per multiplier, so switching from
    // ×3 to a never-played ×8 kept ×3's rows in state, and the next write saved
    // them under the ×8 key. Any game with per-mode keys had the same bug.
    setValue(next);
    setLoaded(true);
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Non-fatal: the game still plays, the score just won't persist.
      }
    },
    [key],
  );

  return [value, set, loaded];
}

/**
 * Tracks a personal best, only writing when the new score actually beats it.
 *
 * `submit` is stable for the component's lifetime — safe to put in an effect's
 * dependency array. It reads the current best through a ref instead of closing
 * over it, so beating your best doesn't change the callback's identity.
 */
export function useBestScore(
  gameSlug: string,
): [number, (score: number) => boolean, boolean] {
  const [best, setBest, loaded] = useLocalStorage(`minigames:best:${gameSlug}`, 0);

  const bestRef = useRef(best);
  bestRef.current = best;

  const submit = useCallback(
    (score: number) => {
      if (score > bestRef.current) {
        bestRef.current = score;
        setBest(score);
        return true;
      }
      return false;
    },
    [setBest],
  );

  return [best, submit, loaded];
}

/**
 * Lifetime counters that persist across runs, for stats like "total flips" or
 * "% heads" that are about the player's whole history rather than one game.
 *
 * Counters are added to, never replaced — `bump({ flips: 1, heads: 1 })`.
 * Generic over the counter names so each game defines its own shape.
 *
 * `bump` and `reset` are stable for the lifetime of the component, so putting
 * them in an effect's dependency array can never cause a re-render loop — even
 * if `initial` is passed as an inline object literal.
 */
export function useLifetimeStats<T extends Record<string, number>>(
  gameSlug: string,
  initial: T,
): [T, (deltas: Partial<Record<keyof T, number>>) => void, boolean, () => void] {
  const [stats, setStats, loaded] = useLocalStorage<T>(
    `minigames:stats:${gameSlug}`,
    initial,
  );

  // Snapshot `initial` once. Without this, a caller passing an inline object
  // (`useLifetimeStats("x", { a: 0 })`) gets a new reference every render, which
  // makes `reset` unstable and can loop any effect that depends on it.
  const initialRef = useRef(initial);

  // Reads the latest value via a ref so rapid successive bumps in the same tick
  // don't each start from the same stale snapshot and lose counts.
  const ref = useRef(stats);
  ref.current = stats;

  const bump = useCallback(
    (deltas: Partial<Record<keyof T, number>>) => {
      const next = { ...ref.current };
      for (const k in deltas) {
        const d = deltas[k as keyof T];
        if (typeof d === "number") {
          next[k as keyof T] = ((next[k as keyof T] ?? 0) + d) as T[keyof T];
        }
      }
      ref.current = next;
      setStats(next);
    },
    [setStats],
  );

  const reset = useCallback(() => setStats(initialRef.current), [setStats]);

  return [stats, bump, loaded, reset];
}

/**
 * An append-only log of past events — every guess, every run, every attempt.
 *
 * Distinct from useLifetimeStats, which only keeps running totals. Games that
 * want to chart a history rather than print a number need the raw rows, so
 * this keeps them, oldest first, capped so a heavy player can't fill up the
 * origin's storage quota.
 *
 * `append` and `clear` are stable for the component's lifetime, same contract
 * as the hooks above — both the entries and the cap are read through refs, so
 * recording an entry never changes the callback's identity.
 */
export function useHistoryLog<T>(
  key: string,
  cap = 2000,
): [T[], (entry: T) => void, boolean, () => void] {
  const [entries, setEntries, loaded] = useLocalStorage<T[]>(
    `minigames:history:${key}`,
    [],
  );

  // Same trick as useLifetimeStats: several appends in one tick must not each
  // start from the same stale snapshot.
  const ref = useRef(entries);
  ref.current = entries;
  const capRef = useRef(cap);
  capRef.current = cap;

  const append = useCallback(
    (entry: T) => {
      const limit = capRef.current;
      const next = [...ref.current, entry];
      const trimmed =
        next.length > limit ? next.slice(next.length - limit) : next;
      ref.current = trimmed;
      setEntries(trimmed);
    },
    [setEntries],
  );

  const clear = useCallback(() => {
    ref.current = [];
    setEntries([]);
  }, [setEntries]);

  return [entries, append, loaded, clear];
}

export interface LeaderboardEntry {
  id: string;
  score: number;
  date: string;
  name?: string;
}

/**
 * Tracks a top-N leaderboard for a game in localStorage.
 *
 * `addScore` and `clearLeaderboard` are stable for the component's lifetime, so
 * they are safe to list in an effect's dependency array. Reading `entries`
 * through a ref rather than closing over it is what keeps `addScore` stable —
 * otherwise every recorded score changes its identity and any effect depending
 * on it fires again, writing another score, forever.
 */
export function useLeaderboard(
  gameSlug: string,
  maxEntries = 5,
): [LeaderboardEntry[], (score: number, name?: string) => boolean, boolean, () => void] {
  const [entries, setEntries, loaded] = useLocalStorage<LeaderboardEntry[]>(
    `minigames:leaderboard:${gameSlug}`,
    [],
  );

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const maxRef = useRef(maxEntries);
  maxRef.current = maxEntries;

  const addScore = useCallback(
    (score: number, name?: string) => {
      if (score <= 0) return false;

      const newEntry: LeaderboardEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        score,
        date: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        ...(name ? { name } : {}),
      };

      const updated = [...entriesRef.current, newEntry]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxRef.current);

      const madeBoard = updated.some((e) => e.id === newEntry.id);
      if (madeBoard) {
        entriesRef.current = updated;
        setEntries(updated);
      }
      return madeBoard;
    },
    [setEntries],
  );

  const clearLeaderboard = useCallback(() => {
    setEntries([]);
  }, [setEntries]);

  return [entries, addScore, loaded, clearLeaderboard];
}

