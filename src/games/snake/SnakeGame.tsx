"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore } from "@/lib/useLocalStorage";
import {
  COLS,
  ROWS,
  TICK_MS,
  createGame,
  dirForKey,
  queueTurn,
  step,
  type Dir,
  type SnakeState,
} from "./logic";

const CELL = 16;

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SnakeState>(() => createGame());
  const [best, submitBest, bestLoaded] = useBestScore("snake");
  const [started, setStarted] = useState(false);

  // The tick reads state via ref so the interval doesn't need re-creating
  // on every frame (which would reset the timer and stutter the snake).
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => {
    setState(createGame());
    setStarted(true);
  }, []);

  const turn = useCallback((dir: Dir) => {
    setState((s) => queueTurn(s, dir));
  }, []);

  useEffect(() => {
    if (!started || state.dead) return;
    const id = setInterval(() => setState((s) => step(s)), TICK_MS);
    return () => clearInterval(id);
  }, [started, state.dead]);

  // Record the best score once per death.
  useEffect(() => {
    if (state.dead) submitBest(state.score);
  }, [state.dead, state.score, submitBest]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dir = dirForKey(e.key);
      if (dir) e.preventDefault(); // stop arrows scrolling the page
      if (!started) {
        setStarted(true);
        if (dir) turn(dir);
        return;
      }
      if (stateRef.current.dead) {
        if (e.key === " " || e.key === "Enter" || dir) reset();
        return;
      }
      if (dir) turn(dir);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, reset, turn]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#171a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    state.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#a692ff" : "#7c5cff";
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });

    ctx.fillStyle = "#ff5c8a";
    ctx.fillRect(state.food.x * CELL + 1, state.food.y * CELL + 1, CELL - 2, CELL - 2);

    if (state.dead || !started) {
      ctx.fillStyle = "rgba(15,17,32,0.78)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#e6e7f0";
      ctx.textAlign = "center";
      ctx.font = "bold 22px -apple-system, system-ui, sans-serif";
      ctx.fillText(
        state.dead ? "Game Over" : "Ready?",
        canvas.width / 2,
        canvas.height / 2 - 6,
      );
      ctx.fillStyle = "#8f92aa";
      ctx.font = "13px -apple-system, system-ui, sans-serif";
      ctx.fillText(
        state.dead ? "Press any key to play again" : "Press any key to start",
        canvas.width / 2,
        canvas.height / 2 + 18,
      );
    }
  }, [state, started]);

  // Swipe controls
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touchStart.current;
    touchStart.current = null;
    if (!t0) return;
    if (!started || state.dead) {
      reset();
      return;
    }
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) turn({ x: dx > 0 ? 1 : -1, y: 0 });
    else turn({ x: 0, y: dy > 0 ? 1 : -1 });
  };

  return (
    <>
      <ScoreBar
        stats={[
          { label: "Score", value: state.score },
          { label: "Best", value: best, muted: !bestLoaded },
          { label: "Length", value: state.snake.length },
        ]}
      />

      <Box
        component="canvas"
        ref={canvasRef}
        width={COLS * CELL}
        height={ROWS * CELL}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        sx={{
          border: "2px solid",
          borderColor: "primary.main",
          borderRadius: 1.5,
          maxWidth: "100%",
          height: "auto",
          touchAction: "none",
        }}
      />

      {state.dead ? (
        <Button variant="contained" onClick={reset}>
          Play again
        </Button>
      ) : !started ? (
        <Button variant="contained" onClick={() => setStarted(true)}>
          Start
        </Button>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Don&apos;t hit the walls.
        </Typography>
      )}
    </>
  );
}
