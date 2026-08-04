"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Celebration from "@/components/Celebration";
import PlayerList from "@/components/multiplayer/PlayerList";
import type { RoomPlayer } from "@/lib/useRoom";

/** Mirrors publicState() in ./server.js. */
export interface DuelPublicState {
  phase: "lobby" | "playing" | "over";
  settings: { multiplier: number; startSeconds: number; abyssSeconds: number };
  players: {
    userId: string;
    clock: number;
    alive: boolean;
    solved: number;
    eliminatedBy: string | null;
  }[];
  turnIndex: number;
  currentUserId: string | null;
  prompt: number;
  turns: number;
  maxTurns: number;
  winner: string | null;
  lastTurn: { userId: string; took: number | null; gaveEach: number; correct: boolean } | null;
  wins: Record<string, number>;
  limits: {
    startSeconds: { min: number; max: number };
    abyssSeconds: { min: number; max: number };
  };
  multipliers: number[];
}

/** Host-only lobby settings. Everyone else sees the values read-only. */
function SettingsPanel({
  state,
  isHost,
  onChange,
}: {
  state: DuelPublicState;
  isHost: boolean;
  onChange: (partial: Record<string, number>) => void;
}) {
  const { settings, limits, multipliers } = state;

  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2, borderRadius: 2, bgcolor: "background.paper" }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.75rem",
          mb: 1.5,
        }}
      >
        {isHost ? "Game settings" : "Host's settings"}
      </Typography>

      <Stack spacing={2.5}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Multiply by
          </Typography>
          <ToggleButtonGroup
            value={settings.multiplier}
            exclusive
            size="small"
            disabled={!isHost}
            onChange={(_, m) => {
              if (m !== null) onChange({ multiplier: m });
            }}
            sx={{ flexWrap: "wrap", mt: 0.5 }}
          >
            {multipliers.map((m) => (
              <ToggleButton key={m} value={m} sx={{ px: 1.5, fontWeight: 700 }}>
                ×{m}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Starting clock — <b>{settings.startSeconds}s</b> each
          </Typography>
          <Slider
            value={settings.startSeconds}
            min={limits.startSeconds.min}
            max={limits.startSeconds.max}
            step={5}
            disabled={!isHost}
            marks={[
              { value: limits.startSeconds.min, label: `${limits.startSeconds.min}s` },
              { value: limits.startSeconds.max, label: `${limits.startSeconds.max}s` },
            ]}
            onChangeCommitted={(_, v) => onChange({ startSeconds: v as number })}
            size="small"
          />
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Into the abyss — <b>{settings.abyssSeconds}s</b> per turn
          </Typography>
          <Slider
            value={settings.abyssSeconds}
            min={limits.abyssSeconds.min}
            max={limits.abyssSeconds.max}
            step={0.25}
            disabled={!isHost}
            marks={[
              { value: limits.abyssSeconds.min, label: `${limits.abyssSeconds.min}s` },
              { value: limits.abyssSeconds.max, label: `${limits.abyssSeconds.max}s` },
            ]}
            onChangeCommitted={(_, v) => onChange({ abyssSeconds: v as number })}
            size="small"
          />
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
            Time swallowed on every turn instead of being passed on. This is what
            makes the game end — a bigger abyss means a shorter game.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

/** One row per player: clock, turn marker, wins. */
function Clocks({
  state,
  players,
  userId,
}: {
  state: DuelPublicState;
  players: RoomPlayer[];
  userId: string;
}) {
  const nameFor = (id: string) =>
    id === userId ? "You" : (players.find((p) => p.id === id)?.name ?? "Player");

  return (
    <Stack spacing={0.75} sx={{ width: "100%" }}>
      {state.players.map((p) => {
        const isTurn = state.currentUserId === p.userId && state.phase === "playing";
        const low = p.clock < 5;
        return (
          <Box
            key={p.userId}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 1.5,
              py: 0.85,
              borderRadius: 1.5,
              bgcolor: isTurn ? "rgba(124,92,255,0.18)" : "action.hover",
              border: isTurn ? "1px solid" : "1px solid transparent",
              borderColor: isTurn ? "primary.main" : "transparent",
              opacity: p.alive ? 1 : 0.4,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: p.userId === userId ? 700 : 500 }}>
                {nameFor(p.userId)}
              </Typography>
              {isTurn ? <Typography variant="caption">⏳ thinking</Typography> : null}
              {!p.alive ? (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {p.eliminatedBy === "wrong" ? "wrong answer" : "out of time"}
                </Typography>
              ) : null}
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              {state.wins[p.userId] ? (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {state.wins[p.userId]}W
                </Typography>
              ) : null}
              <Typography
                sx={{
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                  color: !p.alive ? "text.secondary" : low ? "#ff5c8a" : "text.primary",
                }}
              >
                {p.clock.toFixed(1)}s
              </Typography>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

export default function DoubleItDuelRoom({
  state,
  players,
  userId,
  isHost,
  send,
}: {
  state: DuelPublicState;
  players: RoomPlayer[];
  userId: string;
  isHost: boolean;
  send: (event: string, data?: unknown) => void;
}) {
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const myTurn = state.currentUserId === userId && state.phase === "playing";

  const nameFor = useCallback(
    (id: string | null) =>
      !id ? "" : id === userId ? "You" : (players.find((p) => p.id === id)?.name ?? "Player"),
    [players, userId],
  );

  // Clear and focus the box the moment the turn comes round.
  useEffect(() => {
    if (!myTurn) return;
    setAnswer("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [myTurn, state.prompt]);

  function submit() {
    const parsed = Number(answer.trim());
    if (!Number.isFinite(parsed) || answer.trim() === "") return;
    send("answer", { answer: parsed });
    setAnswer("");
  }

  const me = state.players.find((p) => p.userId === userId);
  const myClock = me?.clock ?? 0;
  const clockPct = Math.min(100, (myClock / state.settings.startSeconds) * 100);

  return (
    <Stack spacing={2.5} sx={{ width: "100%", alignItems: "center" }}>
      <Celebration
        active={state.phase === "over" && state.winner === userId}
        celebrationKey={`duel-win-${state.turns}`}
      />

      {state.phase === "lobby" ? (
        <>
          <SettingsPanel
            state={state}
            isHost={isHost}
            onChange={(partial) => send("settings", partial)}
          />
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            Your clock only runs on your turn. Answer right and the time you took —
            minus the abyss — is split among everyone else. Overflow above{" "}
            {state.settings.startSeconds}s is allowed.
          </Typography>
          {isHost ? (
            <Button
              variant="contained"
              size="large"
              onClick={() => send("start")}
              disabled={players.filter((p) => p.connected).length < 2}
            >
              Start ×{state.settings.multiplier}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host to start…
            </Typography>
          )}
        </>
      ) : null}

      {state.phase === "playing" ? (
        <>
          <Stack direction="row" spacing={2} sx={{ color: "text.secondary" }}>
            <Typography variant="caption">×{state.settings.multiplier}</Typography>
            <Typography variant="caption">
              abyss {state.settings.abyssSeconds}s
            </Typography>
            <Typography variant="caption">turn {state.turns + 1}</Typography>
          </Stack>

          <Box sx={{ width: "100%", maxWidth: 380 }}>
            <LinearProgress
              variant="determinate"
              value={clockPct}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: "action.hover",
                "& .MuiLinearProgress-bar": {
                  bgcolor: myClock < 5 ? "#ff5c8a" : "primary.main",
                  transition: "none",
                },
              }}
            />
          </Box>

          {myTurn ? (
            <Stack spacing={2} alignItems="center">
              <Stack direction="row" spacing={1.5} alignItems="baseline">
                <Typography
                  sx={{ fontSize: "3.25rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}
                >
                  {state.prompt.toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: "1.4rem", fontWeight: 700, color: "text.secondary" }}>
                  × {state.settings.multiplier}
                </Typography>
              </Stack>
              <TextField
                inputRef={inputRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/[^\d-]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder={`× ${state.settings.multiplier}`}
                autoComplete="off"
                inputProps={{
                  inputMode: "numeric",
                  style: { textAlign: "center", fontSize: "1.5rem", fontWeight: 700 },
                }}
                sx={{ width: 220 }}
              />
              <Button variant="contained" onClick={submit} disabled={answer.trim() === ""}>
                Answer
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1} alignItems="center" sx={{ py: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {nameFor(state.currentUserId)} is thinking…
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Every second they take is mostly yours.
              </Typography>
            </Stack>
          )}

          {state.lastTurn ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
              {state.lastTurn.correct
                ? `${nameFor(state.lastTurn.userId)} answered in ${(state.lastTurn.took ?? 0).toFixed(1)}s — everyone else gained ${state.lastTurn.gaveEach.toFixed(1)}s`
                : `${nameFor(state.lastTurn.userId)} is out`}
            </Typography>
          ) : null}
        </>
      ) : null}

      {state.phase === "over" ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 800, textAlign: "center" }}>
            {state.winner === null
              ? "Draw"
              : state.winner === userId
                ? "🏆 You win"
                : `${nameFor(state.winner)} wins`}
          </Typography>
          {state.turns >= state.maxTurns ? (
            <Alert severity="info" sx={{ width: "100%" }}>
              Turn limit reached — most time banked takes it.
            </Alert>
          ) : null}
          {isHost ? (
            <Button variant="contained" onClick={() => send("again")}>
              Back to settings
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host…
            </Typography>
          )}
        </Stack>
      ) : null}

      <Clocks state={state} players={players} userId={userId} />
      <PlayerList players={players} userId={userId} />
    </Stack>
  );
}
