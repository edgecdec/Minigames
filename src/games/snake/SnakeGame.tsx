"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import GameSidebar, { type SidebarConfig } from "@/components/GameSidebar";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLeaderboard, useLifetimeStats } from "@/lib/useLocalStorage";
import {
  COLS,
  TICK_MS,
  createGame,
  dirForKey,
  queueTurn,
  step,
  type Dir,
  type SnakeState,
} from "./logic";

const CELL = 16;
const BOARD_PX = COLS * CELL; // 320 — the grid is square, so this is both dimensions

const COUNTERS = { games: 0, food: 0, bestLength: 0 };

const SIDEBAR: SidebarConfig<typeof COUNTERS> = {
  leaderboard: { title: "Best runs", unit: "pts" },
  stats: {
    rows: (c) => [
      { label: "Games played", value: c.games },
      { label: "Food eaten", value: c.food },
      {
        label: "Average score",
        value: c.games > 0 ? (c.food / c.games).toFixed(1) : "—",
      },
      { label: "Longest snake", value: c.bestLength > 0 ? c.bestLength : "—" },
    ],
  },
};

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SnakeState>(() => createGame());
  const [best, submitBest, bestLoaded] = useBestScore("snake");
  const [leaderboard, submitLeaderboard, leaderboardLoaded] = useLeaderboard("snake");
  const [stats, bumpStats, statsLoaded] = useLifetimeStats("snake", COUNTERS);
  const [started, setStarted] = useState(false);
  // The snake holds still until the first steer. Without this, clicking Start
  // with the mouse gives you ~1.1s to reach the keyboard before hitting a wall.
  const [moving, setMoving] = useState(false);
  // Bumped after a resize so the draw effect re-runs against the new transform.
  const [redraw, setRedraw] = useState(0);

  // The tick reads state via ref so the interval doesn't need re-creating
  // on every frame (which would reset the timer and stutter the snake).
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => {
    setState(createGame());
    setStarted(true);
    setMoving(false);
  }, []);

  const turn = useCallback((dir: Dir) => {
    setMoving(true);
    setState((s) => queueTurn(s, dir));
  }, []);

  useEffect(() => {
    if (!started || !moving || state.dead) return;
    const id = setInterval(() => setState((s) => step(s)), TICK_MS);
    return () => clearInterval(id);
  }, [started, moving, state.dead]);

  // Record results exactly once per death. Without the ref guard this effect
  // re-runs on unrelated re-renders and double-counts games played.
  const recorded = useRef(false);
  useEffect(() => {
    if (!state.dead) {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    recorded.current = true;

    submitBest(state.score);
    submitLeaderboard(state.score);
    bumpStats({
      games: 1,
      food: state.score,
      // bestLength is a max, not a sum — bump by the difference when beaten.
      bestLength: Math.max(0, state.snake.length - stats.bestLength),
    });
  }, [
    state.dead,
    state.score,
    state.snake.length,
    stats.bestLength,
    submitBest,
    submitLeaderboard,
    bumpStats,
  ]);

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

  // Size the drawing buffer to the element's real size × DPR, then scale the
  // context so all drawing below can stay in CSS/grid units.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const el = canvasRef.current;
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      const cssSize = el.clientWidth || BOARD_PX;
      el.width = Math.round(cssSize * dpr);
      el.height = Math.round(cssSize * dpr);
      const ctx = el.getContext("2d");
      // Map 1 unit == 1 CSS px, and CSS px == BOARD_PX across the board, so the
      // grid math is identical regardless of how wide the element actually is.
      ctx?.setTransform(
        (cssSize / BOARD_PX) * dpr, 0, 0,
        (cssSize / BOARD_PX) * dpr, 0, 0,
      );
      setRedraw((n) => n + 1);
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#171a2e";
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    state.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#a692ff" : "#7c5cff";
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });

    ctx.fillStyle = "#ff5c8a";
    ctx.fillRect(state.food.x * CELL + 1, state.food.y * CELL + 1, CELL - 2, CELL - 2);

    if (state.dead || !started || !moving) {
      ctx.fillStyle = "rgba(15,17,32,0.78)";
      ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
      ctx.fillStyle = "#e6e7f0";
      ctx.textAlign = "center";
      ctx.font = "bold 22px -apple-system, system-ui, sans-serif";
      ctx.fillText(
        state.dead ? "Game Over" : started ? "Steer to begin" : "Ready?",
        BOARD_PX / 2,
        BOARD_PX / 2 - 6,
      );
      ctx.fillStyle = "#8f92aa";
      ctx.font = "13px -apple-system, system-ui, sans-serif";
      ctx.fillText(
        state.dead
          ? "Press any key to play again"
          : started
            ? "Arrow keys, WASD, or swipe"
            : "Press any key to start",
        BOARD_PX / 2,
        BOARD_PX / 2 + 18,
      );
    }
  }, [state, started, moving, redraw]);

  // Swipe controls
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touchStart.current;
    touchStart.current = null;
    if (!t0) return;
    if (state.dead) {
      reset();
      return;
    }
    if (!started) setStarted(true);
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

      {/*
        Plain <canvas>, not <Box component="canvas">: MUI treats width/height as
        style props, so the drawing buffer silently kept its 300x150 default and
        the lower rows were drawn outside the visible area.
        aspectRatio + flexShrink:0 keep it square inside the column flex parent.
      */}
      <canvas
        ref={canvasRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          border: "2px solid #7c5cff",
          borderRadius: 6,
          width: BOARD_PX,
          maxWidth: "100%",
          aspectRatio: "1 / 1",
          height: "auto",
          flexShrink: 0,
          touchAction: "none",
          display: "block",
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
          {moving ? "Don't hit the walls." : "Steer to start moving."}
        </Typography>
      )}

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
