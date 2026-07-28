"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GameSidebar, { percent, type SidebarConfig } from "@/components/GameSidebar";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLeaderboard, useLifetimeStats, useLocalStorage } from "@/lib/useLocalStorage";
import { dailyRng, msUntilTomorrow, todayKey } from "@/lib/dailySeed";
import {
  DAILY_ROLLS,
  MAX_ROLL,
  bestRoll,
  dayScore,
  rollsForDay,
  tierFor,
  type Roll,
} from "./logic";

const COUNTERS = {
  days: 0,
  rolls: 0,
  golden: 0,
  rare: 0,
  legendary: 0,
  mythic: 0,
};

const SIDEBAR: SidebarConfig<typeof COUNTERS> = {
  leaderboard: { title: "Best days", unit: "pts" },
  stats: {
    rows: (c) => [
      { label: "Days played", value: c.days },
      { label: "Total rolls", value: c.rolls },
      { label: "Golden pulls", value: c.golden, hint: percent(c.golden, c.rolls) },
      { label: "Rare or better", value: c.rare, hint: percent(c.rare, c.rolls) },
      { label: "Legendary", value: c.legendary },
      { label: "Mythic", value: c.mythic },
    ],
  },
};

function RollChip({ roll, big = false }: { roll: Roll; big?: boolean }) {
  const def = tierFor(roll.value);
  return (
    <Box
      sx={{
        px: big ? 2.5 : 1.25,
        py: big ? 1.5 : 0.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: roll.golden ? "#ffd76a" : def.color,
        bgcolor: roll.golden ? "rgba(255,215,106,0.10)" : "action.hover",
        textAlign: "center",
        minWidth: big ? 160 : 62,
        boxShadow: roll.golden ? "0 0 14px rgba(255,215,106,0.25)" : "none",
      }}
    >
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: big ? "2.5rem" : "0.95rem",
          lineHeight: 1.1,
          color: roll.golden ? "#ffd76a" : def.color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {roll.golden ? "✨" : ""}
        {roll.value.toLocaleString()}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", fontSize: big ? "0.75rem" : "0.6rem" }}
      >
        {def.label}
        {roll.golden ? " · Golden" : ""}
      </Typography>
    </Box>
  );
}

export default function RngdleGame() {
  const day = todayKey();
  // Persist only the roll COUNT — the values are regenerated from the daily
  // seed, so storage can't be edited to fake a better pull.
  const [saved, setSaved, savedLoaded] = useLocalStorage<{ day: string; taken: number }>(
    "minigames:rngdle:progress",
    { day, taken: 0 },
  );

  const taken = saved.day === day ? saved.taken : 0;
  const [revealing, setRevealing] = useState(false);
  const [countdown, setCountdown] = useState("");

  const [best, submitBest, bestLoaded] = useBestScore("rngdle");
  const [leaderboard, submitLeaderboard, leaderboardLoaded] = useLeaderboard("rngdle");
  const [stats, bumpStats, statsLoaded] = useLifetimeStats("rngdle", COUNTERS);

  // The whole day's sequence is deterministic; we just reveal a prefix of it.
  const allRolls = useMemo(
    () => rollsForDay(dailyRng("rngdle", day), DAILY_ROLLS),
    [day],
  );
  const revealed = allRolls.slice(0, taken);
  const latest = revealed.length > 0 ? revealed[revealed.length - 1] : null;
  const dayBest = bestRoll(revealed);
  const rollsLeft = DAILY_ROLLS - taken;
  const done = rollsLeft <= 0;

  const roll = useCallback(() => {
    if (done || revealing || !savedLoaded) return;
    setRevealing(true);
    const next = allRolls[taken];
    window.setTimeout(() => {
      setSaved({ day, taken: taken + 1 });
      bumpStats({
        rolls: 1,
        golden: next.golden ? 1 : 0,
        rare: ["rare", "epic", "legendary", "mythic"].includes(next.tier) ? 1 : 0,
        legendary: next.tier === "legendary" ? 1 : 0,
        mythic: next.tier === "mythic" ? 1 : 0,
      });
      setRevealing(false);
    }, 320);
  }, [done, revealing, savedLoaded, allRolls, taken, day, setSaved, bumpStats]);

  // Record the day once its rolls are spent.
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!savedLoaded || !done || recorded.current === day) return;
    recorded.current = day;
    const s = dayScore(revealed);
    submitBest(s);
    submitLeaderboard(s);
    bumpStats({ days: 1 });
  }, [savedLoaded, done, day, revealed, submitBest, submitLeaderboard, bumpStats]);

  // "Next puzzle in" countdown, once the day is spent.
  useEffect(() => {
    if (!done) return;
    const tick = () => {
      const ms = msUntilTomorrow();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [done]);

  return (
    <>
      <ScoreBar
        stats={[
          { label: "Rolls left", value: rollsLeft },
          { label: "Today's best", value: dayBest ? dayBest.value.toLocaleString() : "—" },
          { label: "Best ever", value: best.toLocaleString(), muted: !bestLoaded },
        ]}
      />

      <Chip
        label={`Daily puzzle · ${day}`}
        size="small"
        sx={{ bgcolor: "rgba(124,92,255,0.15)", color: "#a692ff", fontSize: "0.7rem" }}
      />

      <Box sx={{ minHeight: 108, display: "flex", alignItems: "center" }}>
        {revealing ? (
          <Typography sx={{ fontSize: "2.5rem", fontWeight: 800, color: "text.secondary" }}>
            ????
          </Typography>
        ) : latest ? (
          <RollChip roll={latest} big />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            {DAILY_ROLLS} rolls a day. Highest number wins.
            <br />
            1 in 50 comes out golden.
          </Typography>
        )}
      </Box>

      {done ? (
        <Stack spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            Out of rolls — day scored {dayScore(revealed).toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Next puzzle in {countdown}
          </Typography>
        </Stack>
      ) : (
        <Button variant="contained" size="large" onClick={roll} disabled={revealing || !savedLoaded}>
          {revealing ? "Rolling…" : `Roll (${rollsLeft} left)`}
        </Button>
      )}

      {revealed.length > 0 ? (
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          sx={{ flexWrap: "wrap", justifyContent: "center", maxWidth: 360 }}
        >
          {revealed.map((r, i) => (
            <RollChip key={i} roll={r} />
          ))}
        </Stack>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        Rolls are 1–{MAX_ROLL.toLocaleString()} · same for everyone today
      </Typography>

      <GameSidebar
        config={SIDEBAR}
        entries={leaderboard}
        entriesLoaded={leaderboardLoaded}
        counters={stats}
        countersLoaded={statsLoaded}
      />
    </>
  );
}
