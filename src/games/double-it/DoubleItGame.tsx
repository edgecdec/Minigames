"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import GameSidebar, { percent, type SidebarConfig } from "@/components/GameSidebar";
import { useGlobalLeaderboard } from "@/lib/useGlobalLeaderboard";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLeaderboard, useLifetimeStats } from "@/lib/useLocalStorage";
import { useCountdown } from "@/lib/useCountdown";
import { createGame, score, submit, timeOut, type DoubleItState } from "./logic";

const COUNTERS = { runs: 0, rounds: 0, correct: 0, wrong: 0, timeouts: 0 };

const SIDEBAR: SidebarConfig<typeof COUNTERS> = {
  leaderboard: { title: "Best runs", unit: "rounds" },
  global: { unit: "rounds" },
  stats: {
    rows: (c) => [
      { label: "Runs played", value: c.runs },
      { label: "Rounds cleared", value: c.rounds },
      {
        label: "Correct answers",
        value: c.correct,
        hint: percent(c.correct, c.correct + c.wrong),
      },
      { label: "Ran out of time", value: c.timeouts },
      {
        label: "Average run",
        value: c.runs > 0 ? (c.rounds / c.runs).toFixed(1) : "—",
      },
    ],
  },
};

export default function DoubleItGame() {
  const [state, setState] = useState<DoubleItState>(() => createGame());
  const [started, setStarted] = useState(false);
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [best, submitBest, bestLoaded] = useBestScore("double-it");
  const [leaderboard, submitLeaderboard, leaderboardLoaded] = useLeaderboard("double-it");
  const [stats, bumpStats, statsLoaded] = useLifetimeStats("double-it", COUNTERS);
  const globalBoard = useGlobalLeaderboard("double-it");

  const handleExpire = useCallback(() => {
    setState((s) => timeOut(s));
  }, []);

  const { remainingMs, start, stop } = useCountdown(handleExpire);

  const begin = useCallback(() => {
    const game = createGame();
    setState(game);
    setAnswer("");
    setStarted(true);
    start(game.allowedMs);
    // Focus after the state flush so the field exists to receive it.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [start]);

  const onSubmit = useCallback(() => {
    if (state.status !== "playing") return;
    const parsed = Number(answer.trim());
    if (!Number.isFinite(parsed) || answer.trim() === "") return;

    const next = submit(state, parsed);
    const gotIt = next.status === "playing";
    bumpStats({ correct: gotIt ? 1 : 0, wrong: gotIt ? 0 : 1 });
    setState(next);
    setAnswer("");
    if (gotIt) start(next.allowedMs);
    else stop();
  }, [answer, state, start, stop, bumpStats]);

  // Record the run once, when it ends.
  const recorded = useRef(false);
  useEffect(() => {
    if (state.status === "playing") {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    recorded.current = true;

    const final = score(state);
    submitBest(final);
    submitLeaderboard(final);
    bumpStats({
      runs: 1,
      rounds: final,
      timeouts: state.lostTo === "time" ? 1 : 0,
    });
  }, [state, submitBest, submitLeaderboard, bumpStats]);

  const dead = state.status === "lost";
  const fraction = state.allowedMs > 0 ? (remainingMs / state.allowedMs) * 100 : 0;
  const seconds = (remainingMs / 1000).toFixed(1);

  return (
    <>
      <ScoreBar
        stats={[
          { label: "Round", value: state.round },
          { label: "Cleared", value: score(state) },
          { label: "Best", value: best, muted: !bestLoaded },
        ]}
      />

      <Box sx={{ width: "100%", maxWidth: 360 }}>
        <LinearProgress
          variant="determinate"
          value={dead || !started ? 0 : fraction}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: "action.hover",
            "& .MuiLinearProgress-bar": {
              // Red under 3s so the pressure is visible, not just numeric.
              bgcolor: remainingMs < 3000 ? "#ff5c8a" : "primary.main",
              transition: "none",
            },
          }}
        />
        <Typography
          variant="caption"
          sx={{
            display: "block",
            textAlign: "center",
            mt: 0.5,
            color: remainingMs < 3000 && started && !dead ? "#ff5c8a" : "text.secondary",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {started && !dead ? `${seconds}s` : `${(state.allowedMs / 1000).toFixed(1)}s allowed`}
        </Typography>
      </Box>

      {!started ? (
        <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            You get a number. Type double it before the clock runs out.
            <br />
            Every round the clock gets 0.1s shorter.
          </Typography>
          <Button variant="contained" size="large" onClick={begin}>
            Start
          </Button>
        </Stack>
      ) : dead ? (
        <Stack spacing={1.5} alignItems="center" sx={{ py: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {state.lostTo === "time" ? "⏱ Out of time" : "✗ Wrong"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            {state.prompt.toLocaleString()} × 2 = {(state.prompt * 2).toLocaleString()}
            {state.lostTo === "wrong" && state.lastAnswer !== undefined
              ? `, you said ${state.lastAnswer.toLocaleString()}`
              : ""}
          </Typography>
          <Typography variant="body1">
            Cleared <b>{score(state)}</b> {score(state) === 1 ? "round" : "rounds"}
          </Typography>
          <Button variant="contained" onClick={begin}>
            Play again
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
          <Typography
            sx={{ fontSize: "3.5rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}
          >
            {state.prompt.toLocaleString()}
          </Typography>
          <TextField
            inputRef={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value.replace(/[^\d-]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="double it"
            autoComplete="off"
            inputProps={{
              inputMode: "numeric",
              style: { textAlign: "center", fontSize: "1.5rem", fontWeight: 700 },
            }}
            sx={{ width: 220 }}
          />
          <Button variant="contained" onClick={onSubmit} disabled={answer.trim() === ""}>
            Submit
          </Button>
        </Stack>
      )}

      <GameSidebar
        config={SIDEBAR}
        entries={leaderboard}
        entriesLoaded={leaderboardLoaded}
        counters={stats}
        countersLoaded={statsLoaded}
        global={globalBoard}
        pendingScore={dead ? score(state) : null}
      />
    </>
  );
}
