"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PlayerList from "@/components/multiplayer/PlayerList";
import SettingsPanel from "@/components/multiplayer/SettingsPanel";
import type { RoomPlayer } from "@/lib/useRoom";

/** Mirrors publicState() in ./server.js. */
export interface DuelPublicState {
  phase: "lobby" | "playing" | "over";
  settings: { multiplier: number; startSeconds: number; abyssSeconds: number };
  players: {
    userId: string;
    ms: number;
    alive: boolean;
    solved: number;
    place: number | null;
  }[];
  turnUserId: string | null;
  prompt: number;
  round: number;
  winner: string | null;
  lastEvent: {
    userId: string;
    kind: "correct" | "wrong" | "timeout";
    prompt: number;
    answer?: number;
    spentMs: number;
    sharedMs: number;
  } | null;
  options: {
    multipliers: number[];
    startSeconds: number[];
    abyssSeconds: number[];
  };
}

function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s >= 10 ? s.toFixed(1) : s.toFixed(2);
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

  const myTurn = state.turnUserId === userId;
  const me = state.players.find((p) => p.userId === userId);
  const nameFor = (id: string) => players.find((p) => p.id === id)?.name ?? "Player";

  // Clear and focus when the turn arrives, so the active player can just type.
  useEffect(() => {
    if (state.phase === "playing" && myTurn) {
      setAnswer("");
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [state.phase, myTurn, state.round]);

  function submit() {
    const trimmed = answer.trim();
    if (trimmed === "") return;
    send("answer", { value: Number(trimmed) });
    setAnswer("");
  }

  const startMs = state.settings.startSeconds * 1000;

  return (
    <Stack spacing={2} sx={{ width: "100%", alignItems: "center" }}>
      {/* Every clock, always visible — the whole tension is watching them move */}
      <Stack spacing={0.75} sx={{ width: "100%" }}>
        {state.players.map((p) => {
          const isTurn = state.turnUserId === p.userId;
          // Overflow past the starting clock is legal, so the bar can cap while
          // the number keeps climbing.
          const pct = Math.min(100, (p.ms / startMs) * 100);
          const low = p.ms < 5_000;
          return (
            <Paper
              key={p.userId}
              elevation={0}
              sx={{
                p: 1.25,
                borderRadius: 2,
                bgcolor: "background.paper",
                border: isTurn ? "2px solid" : "1px solid",
                borderColor: isTurn
                  ? "primary.main"
                  : p.alive
                    ? "rgba(124,92,255,0.14)"
                    : "rgba(255,255,255,0.06)",
                opacity: p.alive ? 1 : 0.45,
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: p.userId === userId ? 700 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.userId === userId ? "You" : nameFor(p.userId)}
                  </Typography>
                  {isTurn && p.alive ? (
                    <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700 }}>
                      ● on turn
                    </Typography>
                  ) : null}
                  {!p.alive ? (
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      out{p.place ? ` · ${p.place}${p.place === 2 ? "nd" : p.place === 3 ? "rd" : "th"}` : ""}
                    </Typography>
                  ) : null}
                </Stack>
                <Stack direction="row" spacing={1.5} alignItems="baseline">
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {p.solved} solved
                  </Typography>
                  <Typography
                    sx={{
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                      color: !p.alive ? "text.secondary" : low ? "#ff5c8a" : "text.primary",
                      minWidth: 62,
                      textAlign: "right",
                    }}
                  >
                    {fmtClock(p.ms)}s
                  </Typography>
                </Stack>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={p.alive ? pct : 0}
                sx={{
                  mt: 0.75,
                  height: 5,
                  borderRadius: 3,
                  bgcolor: "action.hover",
                  "& .MuiLinearProgress-bar": {
                    bgcolor: low ? "#ff5c8a" : isTurn ? "primary.main" : "#39d8ff",
                    transition: "none",
                  },
                }}
              />
            </Paper>
          );
        })}
      </Stack>

      {state.phase === "lobby" ? (
        <>
          <SettingsPanel
            disabled={!isHost}
            note={`Answer fast and the leftover time goes to everyone else — minus ${state.settings.abyssSeconds}s that vanishes for good, which is what forces a game to end. Answer faster than that and you drain them instead.`}
            rows={[
              {
                field: "multiplier",
                label: "Multiply by",
                options: state.options.multipliers,
                value: state.settings.multiplier,
                format: (m) => `×${m}`,
              },
              {
                field: "startSeconds",
                label: "Starting clock",
                hint: "Each player's own time bank.",
                options: state.options.startSeconds,
                value: state.settings.startSeconds,
                format: (s) => `${s}s`,
              },
              {
                field: "abyssSeconds",
                label: "Into the abyss",
                hint: "Destroyed on every answer, so the clock always shrinks.",
                options: state.options.abyssSeconds,
                value: state.settings.abyssSeconds,
                format: (s) => `${s}s`,
              },
            ]}
            onChange={(field, value) => send("settings", { [field]: value })}
          />
          {isHost ? (
            <Button variant="contained" size="large" onClick={() => send("start")}>
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
        <Stack spacing={2} alignItems="center" sx={{ width: "100%", maxWidth: 360 }}>
          <Stack direction="row" spacing={1.5} alignItems="baseline">
            <Typography
              sx={{ fontSize: "3rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}
            >
              {state.prompt.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: "1.4rem", fontWeight: 700, color: "text.secondary" }}>
              × {state.settings.multiplier}
            </Typography>
          </Stack>

          {myTurn && me?.alive ? (
            <>
              <TextField
                inputRef={inputRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/[^\d-]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder={`× ${state.settings.multiplier}`}
                autoComplete="off"
                fullWidth
                inputProps={{
                  inputMode: "numeric",
                  style: { textAlign: "center", fontSize: "1.5rem", fontWeight: 700 },
                }}
              />
              <Button variant="contained" onClick={submit} disabled={answer.trim() === ""}>
                Answer
              </Button>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              {me?.alive
                ? `${nameFor(state.turnUserId ?? "")} is thinking — their clock is running.`
                : "You're out. Watching the rest play it out."}
            </Typography>
          )}

          {state.lastEvent ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
              {state.lastEvent.kind === "timeout"
                ? `${state.lastEvent.userId === userId ? "You" : nameFor(state.lastEvent.userId)} ran out of time.`
                : `${state.lastEvent.userId === userId ? "You" : nameFor(state.lastEvent.userId)} ${
                    state.lastEvent.kind === "correct" ? "got it" : "missed"
                  } in ${(state.lastEvent.spentMs / 1000).toFixed(2)}s · ${
                    state.lastEvent.sharedMs >= 0 ? "+" : ""
                  }${(state.lastEvent.sharedMs / 1000).toFixed(2)}s each to everyone else`}
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {state.phase === "over" ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 800, textAlign: "center" }}>
            {state.winner === null
              ? "Nobody left standing"
              : state.winner === userId
                ? "🏆 You win"
                : `${nameFor(state.winner)} wins`}
          </Typography>
          {me ? (
            <Typography variant="body2" color="text.secondary">
              You solved {me.solved} · finished {me.place ?? "—"}
              {me.place === 1 ? "st" : me.place === 2 ? "nd" : me.place === 3 ? "rd" : "th"}
            </Typography>
          ) : null}
          {isHost ? (
            <Button variant="contained" onClick={() => send("again")}>
              Rematch
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host…
            </Typography>
          )}
          <Alert severity="info" sx={{ width: "100%" }}>
            Settings unlock again in the lobby — the host can change the multiplier
            or the clock before the next game.
          </Alert>
        </Stack>
      ) : null}

      <PlayerList players={players} userId={userId} />
    </Stack>
  );
}
