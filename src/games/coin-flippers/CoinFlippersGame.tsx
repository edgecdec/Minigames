"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GameSidebar, { percent, type SidebarConfig } from "@/components/GameSidebar";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLeaderboard, useLifetimeStats } from "@/lib/useLocalStorage";
import { createInitialState, flipCoin, Side, TARGET_STREAK } from "./logic";

const FLIP_MS = 450;

const COUNTERS = { flips: 0, heads: 0, wins: 0 };

const SIDEBAR: SidebarConfig<typeof COUNTERS> = {
  leaderboard: { title: "Longest streaks", unit: "heads" },
  stats: {
    rows: (c) => [
      { label: "Total flips", value: c.flips },
      { label: "Heads", value: c.heads, hint: percent(c.heads, c.flips) },
      { label: "Tails", value: c.flips - c.heads, hint: percent(c.flips - c.heads, c.flips) },
      { label: "Games won", value: c.wins },
    ],
  },
};

export default function CoinFlippersGame() {
  const [state, setState] = useState(createInitialState);
  const [flipping, setFlipping] = useState(false);

  const [best, submitBest, bestLoaded] = useBestScore("coin-flippers");
  const [leaderboard, submitLeaderboard, leaderboardLoaded] =
    useLeaderboard("coin-flippers");
  const [stats, bumpStats, statsLoaded] = useLifetimeStats("coin-flippers", COUNTERS);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flip = useCallback(() => {
    if (flipping) return;
    if (state.result === "win") return;

    setFlipping(true);

    timer.current = setTimeout(() => {
      setState((prev) => {
        const { nextState, side, endedStreak } = flipCoin(prev);
        bumpStats({
          flips: 1,
          heads: side === "H" ? 1 : 0,
          wins: nextState.result === "win" ? 1 : 0,
        });
        if (endedStreak !== undefined && endedStreak > 0) {
          submitBest(endedStreak);
          submitLeaderboard(endedStreak);
        }
        return nextState;
      });
      setFlipping(false);
    }, FLIP_MS);
  }, [flipping, state.result, submitBest, submitLeaderboard, bumpStats]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState(createInitialState());
    setFlipping(false);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (state.result === "win") reset();
      else flip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, reset, state.result]);

  const won = state.result === "win";

  return (
    <>
      <ScoreBar
        stats={[
          { label: "Streak", value: state.streak },
          { label: "Best", value: best, muted: !bestLoaded },
          { label: "Target", value: TARGET_STREAK },
        ]}
      />

      <Box
        onClick={won ? reset : flip}
        role="button"
        tabIndex={-1}
        aria-label="Flip the coin"
        sx={{
          width: 132,
          height: 132,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: flipping ? "default" : "pointer",
          userSelect: "none",
          fontSize: "3rem",
          fontWeight: 800,
          color: "#0f1120",
          background:
            state.face === "H"
              ? "linear-gradient(145deg,#ffd76a,#e0a020)"
              : "linear-gradient(145deg,#c9ccd8,#8b8fa3)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          transition: "transform 120ms",
          animation: flipping ? "coinspin 450ms linear" : "none",
          "@keyframes coinspin": {
            "0%": { transform: "rotateY(0deg) scale(1)" },
            "50%": { transform: "rotateY(540deg) scale(1.08)" },
            "100%": { transform: "rotateY(1080deg) scale(1)" },
          },
          "&:active": { transform: flipping ? "none" : "scale(0.96)" },
        }}
      >
        {flipping ? "" : state.face === "H" ? "H" : "T"}
      </Box>

      <Stack direction="row" spacing={0.5} sx={{ minHeight: 22 }}>
        {state.history.map((s: Side, i: number) => (
          <Box
            key={i}
            sx={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              fontSize: "0.6rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0f1120",
              bgcolor: s === "H" ? "#ffd76a" : "#8b8fa3",
            }}
          >
            {s}
          </Box>
        ))}
      </Stack>

      <Box sx={{ textAlign: "center", minHeight: 72 }}>
        {won ? (
          <Stack spacing={1.5} alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 700, color: "#ffd76a" }}>
              🎉 Ten in a row!
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Odds of that: 1 in 1,024
            </Typography>
            <Button variant="contained" onClick={reset}>
              Play again
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5} alignItems="center">
            <Typography
              variant="body2"
              color={state.result === "lose" ? "#ff5c8a" : "text.secondary"}
              sx={{ minHeight: 20 }}
            >
              {flipping
                ? "Flipping…"
                : state.result === "lose"
                  ? "Tails. Streak reset."
                  : state.streak > 0
                    ? `${state.streak} heads in a row — keep going.`
                    : "Flip to begin."}
            </Typography>
            <Button variant="contained" onClick={flip} disabled={flipping}>
              Flip
            </Button>
          </Stack>
        )}
      </Box>

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
