"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import GameSidebar, { type SidebarConfig } from "@/components/GameSidebar";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLeaderboard, useLifetimeStats } from "@/lib/useLocalStorage";
import {
  advanceLevel,
  createGame,
  dirForKey,
  queueTurn,
  step,
  type Dir,
  type GameMode,
  type SnakeState,
} from "./logic";

const VIRTUAL_BOARD_PX = 420;

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
  const [mode, setMode] = useState<GameMode>("classic");
  const [state, setState] = useState<SnakeState>(() => createGame("classic"));
  const [bestClassic, submitBestClassic, bestClassicLoaded] = useBestScore("snake");
  const [bestMaze, submitBestMaze, bestMazeLoaded] = useBestScore("snake_maze");
  const [leaderboard, submitLeaderboard, leaderboardLoaded] = useLeaderboard("snake");
  const [stats, bumpStats, statsLoaded] = useLifetimeStats("snake", COUNTERS);
  const bestScore = mode === "classic" ? bestClassic : bestMaze;
  const bestLoaded = mode === "classic" ? bestClassicLoaded : bestMazeLoaded;
  const submitBest = mode === "classic" ? submitBestClassic : submitBestMaze;
  const [started, setStarted] = useState(false);
  const [moving, setMoving] = useState(false);
  const [redraw, setRedraw] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback((newMode: GameMode = mode) => {
    setState(createGame(newMode));
    setStarted(true);
    setMoving(false);
  }, [mode]);

  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: GameMode | null) => {
    if (!newMode || newMode === mode) return;
    setMode(newMode);
    setState(createGame(newMode));
    setStarted(false);
    setMoving(false);
  };

  const handleNextRound = useCallback(() => {
    setState((s) => advanceLevel(s));
    setStarted(true);
    setMoving(false);
  }, []);

  const turn = useCallback((dir: Dir) => {
    setMoving(true);
    setState((s) => queueTurn(s, dir));
  }, []);

  // Game loop interval based on dynamic tickMs per level/mode
  useEffect(() => {
    if (!started || !moving || state.dead || state.wonRound) return;
    const id = setInterval(() => setState((s) => step(s)), state.tickMs);
    return () => clearInterval(id);
  }, [started, moving, state.dead, state.wonRound, state.tickMs]);

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

    if (state.mode !== "classic") return;

    submitBestClassic(state.score);
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
    submitBestClassic,
    submitLeaderboard,
    bumpStats,
  ]);

  // Persist a maze score as soon as the round is solved, rather than making
  // players deliberately crash to keep their progress.
  useEffect(() => {
    if (state.dead || state.wonRound) submitBest(state.score);
  }, [state.dead, state.score, state.wonRound, submitBest]);

  // Keyboard controls
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dir = dirForKey(e.key);
      if (dir || e.key === " ") e.preventDefault(); // stop page scrolling

      if (stateRef.current.wonRound) {
        if (e.key === " " || e.key === "Enter" || dir) {
          handleNextRound();
        }
        return;
      }

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
  }, [started, reset, turn, handleNextRound]);

  // Resize listener & canvas transform scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const el = canvasRef.current;
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      const cssSize = el.clientWidth || VIRTUAL_BOARD_PX;
      el.width = Math.round(cssSize * dpr);
      el.height = Math.round(cssSize * dpr);
      const ctx = el.getContext("2d");
      ctx?.setTransform(
        (cssSize / VIRTUAL_BOARD_PX) * dpr, 0, 0,
        (cssSize / VIRTUAL_BOARD_PX) * dpr, 0, 0,
      );
      setRedraw((n) => n + 1);
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Canvas drawing effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cols = state.cols;
    const rows = state.rows;
    const cw = VIRTUAL_BOARD_PX / cols;
    const ch = VIRTUAL_BOARD_PX / rows;

    // Background
    ctx.fillStyle = "#171a2e";
    ctx.fillRect(0, 0, VIRTUAL_BOARD_PX, VIRTUAL_BOARD_PX);

    // Render Maze Walls
    if (state.mode === "maze" && state.walls) {
      ctx.fillStyle = "#2d334d";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (state.walls[y][x]) {
            ctx.fillRect(x * cw, y * ch, cw, ch);
            ctx.fillStyle = "#3a4163";
            ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
            ctx.fillStyle = "#2d334d";
          }
        }
      }
    }

    // Render Exit Portal (Maze Mode)
    if (state.mode === "maze" && state.exitOpen) {
      const ex = state.exit.x * cw;
      const ey = state.exit.y * ch;

      ctx.fillStyle = "#00e676";
      ctx.fillRect(ex, ey, cw, ch);
      ctx.fillStyle = "#b9f6ca";
      ctx.fillRect(ex + 2, ey + 2, cw - 4, ch - 4);
    }

    // Render Snake
    state.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#a692ff" : "#7c5cff";
      ctx.fillRect(s.x * cw + 1, s.y * ch + 1, cw - 2, ch - 2);
    });

    if (state.mode === "classic") {
      ctx.fillStyle = "#ff5c8a";
      ctx.fillRect(
        state.food.x * cw + 1,
        state.food.y * ch + 1,
        cw - 2,
        ch - 2,
      );
    }

    // Overlay for game over, victory, or start prompts
    if (state.dead || state.wonRound || !started || !moving) {
      ctx.fillStyle = "rgba(15,17,32,0.82)";
      ctx.fillRect(0, 0, VIRTUAL_BOARD_PX, VIRTUAL_BOARD_PX);
      ctx.fillStyle = "#e6e7f0";
      ctx.textAlign = "center";
      ctx.font = "bold 22px -apple-system, system-ui, sans-serif";

      let title = "Ready?";
      let subtitle = "Press any key or steer to start";

      if (state.dead) {
        title = "Game Over";
        subtitle = "Press any key to try again";
      } else if (state.wonRound) {
        title = `Round ${state.level} Solved! 🎉`;
        subtitle = "Press any key for Next Round";
      } else if (started) {
        title = "Steer to begin";
        subtitle = "Arrow keys, WASD, or swipe";
      }

      ctx.fillText(title, VIRTUAL_BOARD_PX / 2, VIRTUAL_BOARD_PX / 2 - 8);

      ctx.fillStyle = "#8f92aa";
      ctx.font = "13px -apple-system, system-ui, sans-serif";
      ctx.fillText(subtitle, VIRTUAL_BOARD_PX / 2, VIRTUAL_BOARD_PX / 2 + 18);
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
    if (state.wonRound) {
      handleNextRound();
      return;
    }
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

  const scoreStats =
    mode === "classic"
      ? [
          { label: "Score", value: state.score },
          { label: "Best", value: bestScore, muted: !bestLoaded },
          { label: "Length", value: state.snake.length },
        ]
      : [
          { label: "Round", value: state.level },
          { label: "Score", value: state.score },
          { label: "Speed", value: `${state.tickMs}ms` },
          { label: "Best", value: bestScore, muted: !bestLoaded },
        ];

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          size="small"
          aria-label="Snake Game Mode"
        >
          <ToggleButton value="classic" sx={{ px: 2.5, fontWeight: "bold" }}>
            Classic Mode
          </ToggleButton>
          <ToggleButton value="maze" sx={{ px: 2.5, fontWeight: "bold" }}>
            Maze Mode
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <ScoreBar stats={scoreStats} />

      <canvas
        ref={canvasRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          border: mode === "maze" ? "2px solid #00e676" : "2px solid #7c5cff",
          borderRadius: 6,
          width: VIRTUAL_BOARD_PX,
          maxWidth: "100%",
          aspectRatio: "1 / 1",
          height: "auto",
          flexShrink: 0,
          touchAction: "none",
          display: "block",
        }}
      />

      {state.wonRound ? (
        <Button variant="contained" color="success" onClick={handleNextRound}>
          Next Round
        </Button>
      ) : state.dead ? (
        <Button variant="contained" onClick={() => reset(mode)}>
          Play again
        </Button>
      ) : !started ? (
        <Button variant="contained" onClick={() => setStarted(true)}>
          Start
        </Button>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {mode === "maze"
            ? "Navigate the maze to reach the green Exit Portal!"
            : moving
            ? "Don't hit the walls."
            : "Steer to start moving."}
        </Typography>
      )}

      {mode === "classic" && (
        <GameSidebar
          config={SIDEBAR}
          entries={leaderboard}
          entriesLoaded={leaderboardLoaded}
          counters={stats}
          countersLoaded={statsLoaded}
        />
      )}
    </>
  );
}
