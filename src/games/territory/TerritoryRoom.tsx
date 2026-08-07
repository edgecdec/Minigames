"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PlayerList from "@/components/multiplayer/PlayerList";
import SettingsPanel from "@/components/multiplayer/SettingsPanel";
import type { RoomGameProps } from "@/lib/useRoom";
import { dirForKey } from "./logic";

/** Mirrors publicState() in ./server.js. */
export interface TerritoryPublicState {
  phase: "waiting" | "countdown" | "playing" | "over";
  /** Run-length encoded grid: [value, runLength, ...]. */
  grid: number[];
  players: {
    userId: string;
    at: { x: number; y: number };
    trail: { x: number; y: number }[];
    cells: number;
    stalled: boolean;
    timesReset: number;
    everClaimed: number;
  }[];
  mapName: string;
  settings: { mapName: string; raidingAllowed: boolean; roundSeconds: number };
  options: { mapNames: string[]; roundSeconds: number[] };
  tick: number;
  ticksLeft: number;
  secondsLeft: number;
  countdown: number;
  winner: string | null;
  standings: { userId: string; cells: number; timesReset: number }[] | null;
  wins: Record<string, number>;
  raidingAllowed: boolean;
  cols: number;
  rows: number;
  claimable: number;
  protectedTicks: number;
  tickMs: number;
}

/** Board is drawn in these units and scaled to whatever CSS size it gets. */
const BOARD_PX = 640;
const WALL = -1;

/**
 * Territory needs two tones per player — a solid fill for owned land and a
 * brighter one for the trail and head — so the board reads at a glance even when
 * four people overlap.
 */
const YOU = { land: "#4a3d8f", edge: "#7c5cff", head: "#c9b8ff" };
const OTHERS = [
  { land: "#8f3d5c", edge: "#ff5c8a", head: "#ffb8cc" },
  { land: "#2f6b52", edge: "#3ddc97", head: "#b8ffe0" },
  { land: "#8f7a2f", edge: "#ffd76a", head: "#fff0c2" },
  { land: "#2f5f8f", edge: "#6ab8ff", head: "#c2e4ff" },
  { land: "#7a3d8f", edge: "#c96aff", head: "#e8c2ff" },
  { land: "#8f5a2f", edge: "#ff9a4a", head: "#ffd9b8" },
  { land: "#2f8f85", edge: "#4adcd0", head: "#b8fff8" },
];

function paletteFor(userId: string, myId: string, others: string[]) {
  if (userId === myId) return YOU;
  const i = others.indexOf(userId);
  return OTHERS[(i < 0 ? 0 : i) % OTHERS.length];
}

function fmtClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function TerritoryRoom({
  state,
  players,
  userId,
  isHost,
  send,
  roomWins,
}: RoomGameProps<TerritoryPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cell = BOARD_PX / state.cols;

  const nameFor = useCallback(
    (id: string) => players.find((p) => p.id === id)?.name ?? "Player",
    [players],
  );

  /** Unpack the run-length encoded grid the server sends. */
  const grid = useMemo(() => {
    const out = new Array<number>(state.cols * state.rows).fill(0);
    let at = 0;
    for (let i = 0; i + 1 < state.grid.length; i += 2) {
      const value = state.grid[i];
      const run = state.grid[i + 1];
      for (let n = 0; n < run && at < out.length; n++) out[at++] = value;
    }
    return out;
  }, [state.grid, state.cols, state.rows]);

  // Keyboard. Sends a desired direction only — the server owns the outcome.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dir = dirForKey(e.key);
      if (!dir) return;
      // Arrows scroll the page otherwise, which makes the board jump around.
      e.preventDefault();
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

  const otherIds = useMemo(
    () => state.players.map((p) => p.userId).filter((id) => id !== userId),
    [state.players, userId],
  );

  // Draw. A plain <canvas> with imperative sizing: MUI's Box treats width/height
  // as style props, which silently leaves the buffer at the 300x150 default.
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

    ctx.fillStyle = "#12142a";
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

    // Owned land and walls, straight off the grid.
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const v = grid[y * state.cols + x];
        if (v === 0) continue;
        if (v === WALL) {
          ctx.fillStyle = "#2b2f4a";
          ctx.fillRect(x * cell, y * cell, cell, cell);
          continue;
        }
        const owner = state.players[v - 1];
        if (!owner) continue;
        ctx.fillStyle = paletteFor(owner.userId, userId, otherIds).land;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Faint grid over the top, so individual cells stay countable.
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 0.5;
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

    const shielded = state.protectedTicks > 0;

    state.players.forEach((p) => {
      const palette = paletteFor(p.userId, userId, otherIds);
      // Trails brighter than land: an exposed trail is the thing to watch.
      ctx.fillStyle = palette.edge;
      ctx.globalAlpha = 0.85;
      p.trail.forEach((c) => {
        ctx.fillRect(c.x * cell + 0.5, c.y * cell + 0.5, cell - 1, cell - 1);
      });
      ctx.globalAlpha = 1;

      // Head last, so it's never buried under someone else's trail.
      ctx.fillStyle = palette.head;
      ctx.fillRect(p.at.x * cell, p.at.y * cell, cell, cell);

      // Ring while protected, so it's obvious why nobody is being reset.
      if (shielded) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          p.at.x * cell + cell / 2,
          p.at.y * cell + cell / 2,
          cell * 1.1,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      // A stalled raider gets a marker, or the slowdown reads as a frozen game.
      if (p.stalled) {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(p.at.x * cell + cell * 0.35, p.at.y * cell - cell * 0.5, cell * 0.3, cell * 0.3);
      }
    });

    if (state.phase === "countdown") {
      ctx.fillStyle = "rgba(15,17,32,0.72)";
      ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
      ctx.fillStyle = "#e6e7f0";
      ctx.textAlign = "center";
      ctx.font = "bold 96px -apple-system, system-ui, sans-serif";
      ctx.fillText(String(state.countdown), BOARD_PX / 2, BOARD_PX / 2 + 32);
    }
  }, [state, grid, cell, userId, otherIds]);

  const me = state.players.find((p) => p.userId === userId);
  const share = (cells: number) =>
    state.claimable ? Math.round((cells / state.claimable) * 1000) / 10 : 0;
  const leaderboard = [...state.players].sort((a, b) => b.cells - a.cells);

  return (
    <Stack spacing={2} sx={{ width: "100%", alignItems: "center" }}>
      {/* Clock and share, the two numbers that matter while playing. */}
      {state.phase === "playing" || state.phase === "countdown" ? (
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="center"
          sx={{ width: "100%" }}
        >
          <Typography sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            ⏱ {fmtClock(state.secondsLeft)}
          </Typography>
          {me ? (
            <Typography sx={{ fontWeight: 800, color: YOU.head }}>
              {share(me.cells)}% yours
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {/* Standings, colour-matched to the board. */}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ width: "100%", flexWrap: "wrap", justifyContent: "center" }}
      >
        {leaderboard.map((p) => {
          const palette = paletteFor(p.userId, userId, otherIds);
          const mine = p.userId === userId;
          return (
            <Box
              key={p.userId}
              sx={{
                px: 1.5,
                py: 0.75,
                minWidth: 84,
                borderRadius: 2,
                bgcolor: "background.paper",
                border: mine ? "2px solid" : "1px solid",
                borderColor: palette.edge,
                textAlign: "center",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {mine ? "You" : nameFor(p.userId)}
              </Typography>
              <Typography sx={{ fontWeight: 800, color: palette.head, lineHeight: 1.2 }}>
                {share(p.cells)}%
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.6rem" }}>
                {/* Room total, so switching games doesn't reset it. */}
                {roomWins?.[p.userId] ?? state.wins[p.userId] ?? 0} won
              </Typography>
            </Box>
          );
        })}
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

      {state.phase === "playing" ? (
        <>
          <LinearProgress
            variant="determinate"
            // Fills as the round runs down, so the clock has a shape.
            value={Math.max(
              0,
              Math.min(100, 100 - (state.secondsLeft / state.settings.roundSeconds) * 100),
            )}
            sx={{ width: "100%", maxWidth: 480, borderRadius: 1 }}
          />
          <Stack spacing={0.5} alignItems="center">
            {state.protectedTicks > 0 ? (
              <Typography variant="body2" sx={{ fontWeight: 700, color: "success.main" }}>
                🛡 Spawn protection — {Math.ceil((state.protectedTicks * state.tickMs) / 1000)}s
              </Typography>
            ) : null}
            {me?.stalled ? (
              <Typography variant="body2" sx={{ fontWeight: 700, color: "warning.main" }}>
                🐌 Slowed — you&apos;re on enemy ground
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
              Arrow keys, WASD, or swipe · leave your land to draw a trail, get back
              to claim it
            </Typography>
          </Stack>
        </>
      ) : null}

      {state.phase === "waiting" ? (
        <Stack spacing={1.5} sx={{ width: "100%" }} alignItems="center">
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            Claim ground by looping out of your own territory and back. Biggest area
            when the clock runs out wins. Cut someone&apos;s trail and they lose
            everything.
          </Typography>
          <SettingsPanel
            title="Round settings"
            note={
              state.settings.raidingAllowed
                ? "Raiding on: you can take enemy land, but you move slowly on it."
                : "Raiding off: enemy territory is a solid wall."
            }
            disabled={!isHost}
            rows={[
              {
                field: "mapName",
                label: "Map",
                options: state.options.mapNames,
                value: state.settings.mapName,
              },
              {
                field: "roundSeconds",
                label: "Round length",
                options: state.options.roundSeconds,
                value: state.settings.roundSeconds,
                format: (s) => `${Number(s) / 60}m`,
              },
              {
                field: "raidingAllowed",
                label: "Raiding",
                hint: "Capture enemy land at a slower pace",
                options: ["on", "off"],
                value: state.settings.raidingAllowed ? "on" : "off",
              },
            ]}
            onChange={(field, value) =>
              send("settings", {
                [field]: field === "raidingAllowed" ? value === "on" : value,
              })
            }
          />
          {state.players.length < 2 ? (
            <Typography variant="body2" color="text.secondary">
              Waiting for another player — share the room code above.
            </Typography>
          ) : isHost ? (
            <Button variant="contained" size="large" onClick={() => send("start")}>
              Start
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host to start…
            </Typography>
          )}
        </Stack>
      ) : null}

      {state.phase === "over" ? (
        <Stack spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="h6" sx={{ fontWeight: 800, textAlign: "center" }}>
            {state.winner === null
              ? "Draw — nobody held the most ground"
              : state.winner === userId
                ? "🏆 You win"
                : `${nameFor(state.winner)} wins`}
          </Typography>
          <Stack spacing={0.5} sx={{ width: "100%", maxWidth: 340 }}>
            {(state.standings ?? []).map((s, i) => (
              <Stack key={s.userId} direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  {i + 1}. {s.userId === userId ? "You" : nameFor(s.userId)}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {share(s.cells)}%
                  {s.timesReset > 0 ? (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "text.secondary", ml: 1 }}
                    >
                      reset {s.timesReset}×
                    </Typography>
                  ) : null}
                </Typography>
              </Stack>
            ))}
          </Stack>
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

      <PlayerList players={players} userId={userId} wins={roomWins} />
    </Stack>
  );
}
