"use client";

import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Private mode, quota, or corrupt JSON — fall back to `initial`.
    }
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

/** Tracks a personal best, only writing when the new score actually beats it. */
export function useBestScore(
  gameSlug: string,
): [number, (score: number) => boolean, boolean] {
  const [best, setBest, loaded] = useLocalStorage(`minigames:best:${gameSlug}`, 0);

  const submit = useCallback(
    (score: number) => {
      if (score > best) {
        setBest(score);
        return true;
      }
      return false;
    },
    [best, setBest],
  );

  return [best, submit, loaded];
}

export interface LeaderboardEntry {
  id: string;
  score: number;
  date: string;
  name?: string;
}

/** Tracks a top-N leaderboard for a game in localStorage. */
export function useLeaderboard(
  gameSlug: string,
  maxEntries = 5,
): [LeaderboardEntry[], (score: number, name?: string) => boolean, boolean, () => void] {
  const [entries, setEntries, loaded] = useLocalStorage<LeaderboardEntry[]>(
    `minigames:leaderboard:${gameSlug}`,
    [],
  );

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

      const updated = [...entries, newEntry]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxEntries);

      const madeBoard = updated.some((e) => e.id === newEntry.id);
      if (madeBoard) {
        setEntries(updated);
      }
      return madeBoard;
    },
    [entries, maxEntries, setEntries],
  );

  const clearLeaderboard = useCallback(() => {
    setEntries([]);
  }, [setEntries]);

  return [entries, addScore, loaded, clearLeaderboard];
}

