"use client";

import { useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PlayerList from "@/components/multiplayer/PlayerList";
import { dirForKey } from "./logic";
import type { RoomPlayer } from "@/lib/useRoom";

/** Mirrors publicState() in ./server.js. */
export interface DuelPublicState {
  phase: "waiting" | "countdown" | "playing" | "over";
  snakes: {
    userId: string;
    body: { x: number; y: number }[];
    alive: boolean;
    score: number;
    causeOfDeath: string | null;
  }[];
  food: { x: number; y: number }[];
  tick: number;
  winner: string | null;
  countdown: number;
  wins: Record<string, number>;
  cols: number;
  rows: number;
}

const BOARD_PX = 384;
/** You are always purple; your opponent is always cyan. */
const YOU = { head: "#a692ff", body: "#7c5cff" };
const THEM = { head: "#7fe4ff", body: "#39d8ff" };

export default function SnakeDuelRoom({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cell = BOARD_PX / state.cols;

  const nameFor = useCallback(
    (id: string) => players.find((p) => p.id === id)?.name ?? "Player",
    [players],
  );

  // Keyboard. Sends a desired direction only — the server owns the outcome.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dir = dirForKey(e.key);
      if (!dir) return;
      e.preventDefault(); // stop arrows scrolling the page
      send("turn", { dir });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  // Swipe, so a phone can play.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current;
    touch.current = null;
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    const dir =
      Math.abs(dx) > Math.abs(dy)
        ? { x: dx > 0 ? 1 : -1, y: 0 }
        : { x: 0, y: dy > 0 ? 1 : -1 };
    send("turn", { dir });
  };

  // Size the buffer for the display's pixel ratio, then draw in board units.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssSize = canvas.clientWidth || BOARD_PX;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = (cssSize / BOARD_PX) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    ctx.fillStyle = "#171a2e";
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    // Faint grid, so a duel's near-misses are legible.
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 1; i < state.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, BOARD_PX);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(BOARD_PX, i * cell);
      ctx.stroke();
    }

    ctx.fillStyle = "#ff5c8a";
    state.food.forEach((f) => {
      ctx.beginPath();
      ctx.arc(f.x * cell + cell / 2, f.y * cell + cell / 2, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    state.snakes.forEach((s) => {
      const mine = s.userId === userId;
      const palette = mine ? YOU : THEM;
      s.body.forEach((c, i) => {
        ctx.fillStyle = i === 0 ? palette.head : palette.body;
        ctx.globalAlpha = s.alive ? 1 : 0.3;
        ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
      });
      ctx.globalAlpha = 1;
    });

    if (state.phase === "countdown") {
      ctx.fillStyle = "rgba(15,17,32,0.72)";
      ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
      ctx.fillStyle = "#e6e7f0";
      ctx.textAlign = "center";
      ctx.font = "bold 72px -apple-system, system-ui, sans-serif";
      ctx.fillText(String(state.countdown), BOARD_PX / 2, BOARD_PX / 2 + 24);
    }
  }, [state, userId, cell]);

  const me = state.snakes.find((s) => s.userId === userId);
  const them = state.snakes.find((s) => s.userId !== userId);

  return (
    <Stack spacing={2} sx={{ width: "100%", alignItems: "center" }}>
      {/* Scores, colour-coded to match the board */}
      <Stack direction="row" spacing={2} justifyContent="center" sx={{ width: "100%" }}>
        {[
          { s: me, palette: YOU, label: "You" },
          { s: them, palette: THEM, label: them ? nameFor(them.userId) : "Waiting…" },
        ].map((entry, i) => (
          <Box
            key={i}
            sx={{
              flex: 1,
              px: 2,
              py: 1,
              borderRadius: 2,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: entry.s?.alive === false ? "rgba(255,255,255,0.08)" : entry.palette.body,
              textAlign: "center",
              opacity: entry.s?.alive === false ? 0.5 : 1,
            }}
          >
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {entry.label}
            </Typography>
            <Typography sx={{ fontWeight: 800, color: entry.palette.head }}>
              {entry.s?.score ?? 0}
            </Typography>
            {entry.s ? (
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.6rem" }}>
                {state.wins[entry.s.userId] ?? 0} won
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>

      <canvas
        ref={canvasRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          width: BOARD_PX,
          maxWidth: "100%",
          aspectRatio: "1 / 1",
          height: "auto",
          border: "2px solid #7c5cff",
          borderRadius: 6,
          touchAction: "none",
          display: "block",
        }}
      />

      {state.phase === "waiting" ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
          Waiting for a second player — share the room code above.
        </Typography>
      ) : null}

      {state.phase === "playing" ? (
        <Typography variant="caption" color="text.secondary">
          Arrow keys, WASD, or swipe
        </Typography>
      ) : null}

      {state.phase === "over" ? (
        <Stack spacing={1} alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {state.winner === null
              ? "Draw"
              : state.winner === userId
                ? "🏆 You win"
                : `${nameFor(state.winner)} wins`}
          </Typography>
          {me?.causeOfDeath ? (
            <Typography variant="caption" color="text.secondary">
              {me.causeOfDeath === "wall"
                ? "You hit the wall"
                : me.causeOfDeath === "self"
                  ? "You bit yourself"
                  : me.causeOfDeath === "opponent"
                    ? "You ran into them"
                    : "Head-on collision"}
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
        </Stack>
      ) : null}

      {(state.phase === "waiting" || state.phase === "over") && isHost && state.phase === "waiting" ? (
        <Button variant="contained" onClick={() => send("start")}>
          Start
        </Button>
      ) : null}

      <PlayerList players={players} userId={userId} />
    </Stack>
  );
}
