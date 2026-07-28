"use client";

import Stack from "@mui/material/Stack";
import Leaderboard from "@/components/Leaderboard";
import StatsPanel, { type StatRow } from "@/components/StatsPanel";
import type { LeaderboardEntry } from "@/lib/useLocalStorage";

/**
 * Declarative config for a game's leaderboard + lifetime stats.
 *
 * Games describe WHAT to show, not how to lay it out — one place to change if
 * we restyle or reorder these panels across the whole site.
 */
export interface SidebarConfig<T extends Record<string, number>> {
  /** Leaderboard settings. Omit to hide the leaderboard entirely. */
  leaderboard?: {
    title?: string;
    /** Unit suffix on each score, e.g. "heads", "pts", "lvl". */
    unit?: string;
  };
  /**
   * Lifetime stat rows, derived from the raw counters.
   * Return [] to hide the panel until there's something worth showing.
   */
  stats?: {
    title?: string;
    rows: (counters: T) => StatRow[];
  };
}

export default function GameSidebar<T extends Record<string, number>>({
  config,
  entries,
  entriesLoaded,
  counters,
  countersLoaded,
}: {
  config: SidebarConfig<T>;
  entries?: LeaderboardEntry[];
  entriesLoaded?: boolean;
  counters?: T;
  countersLoaded?: boolean;
}) {
  const statRows =
    config.stats && counters ? config.stats.rows(counters) : [];

  return (
    <Stack spacing={2} sx={{ width: "100%", mt: 2 }}>
      {config.leaderboard && entries ? (
        <Leaderboard
          entries={entries}
          title={config.leaderboard.title}
          unit={config.leaderboard.unit}
          loaded={entriesLoaded}
        />
      ) : null}

      {statRows.length > 0 ? (
        <StatsPanel
          rows={statRows}
          title={config.stats?.title}
          loaded={countersLoaded}
        />
      ) : null}
    </Stack>
  );
}

/** Formats a percentage, guarding the divide-by-zero on a fresh profile. */
export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
