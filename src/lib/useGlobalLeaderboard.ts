"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/lib/useLocalStorage";

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  at: number;
  isYou: boolean;
}

export interface MyEntry {
  score: number;
  name: string;
  rank: number;
}

/**
 * Global (server-backed) leaderboard for one game.
 *
 * The chosen name lives in localStorage so returning players aren't asked
 * again; identity itself is a signed httpOnly cookie set by the API.
 */
export function useGlobalLeaderboard(gameSlug: string) {
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [me, setMe] = useState<MyEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName, nameLoaded] = useLocalStorage(
    "minigames:playerName",
    "",
  );

  // Guards against a slow response overwriting a newer one.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(
        `/api/leaderboard?game=${encodeURIComponent(gameSlug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mine !== seq.current) return;
      setEntries(data.entries ?? []);
      setMe(data.me ?? null);
      setError(null);
    } catch {
      if (mine !== seq.current) return;
      // A dead board must never break the game itself.
      setError("Leaderboard unavailable");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [gameSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = useCallback(
    async (score: number, playerName: string) => {
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game: gameSlug, name: playerName, score }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Could not submit score");
          return false;
        }
        // Persist the server's cleaned version, not the raw input.
        if (data.name) setName(data.name);
        setEntries(data.entries ?? []);
        setMe(data.me ?? null);
        setError(null);
        return true;
      } catch {
        setError("Could not submit score");
        return false;
      }
    },
    [gameSlug, setName],
  );

  return {
    entries,
    me,
    loading,
    error,
    name,
    setName,
    nameLoaded,
    submit,
    refresh,
  };
}
