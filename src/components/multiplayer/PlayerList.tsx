"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { RoomPlayer } from "@/lib/useRoom";

/** Who's in the room. Shared by every multiplayer game. */
export default function PlayerList({
  players,
  userId,
  /** Ids that have completed the current step, e.g. locked in a word. */
  readyIds = [],
  readyLabel = "ready",
}: {
  players: RoomPlayer[];
  userId: string;
  readyIds?: string[];
  readyLabel?: string;
}) {
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
        Players ({players.length})
      </Typography>

      <Stack spacing={0.75}>
        {players.map((p) => {
          const ready = readyIds.includes(p.id);
          return (
            <Box
              key={p.id}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                bgcolor: p.id === userId ? "rgba(124,92,255,0.14)" : "action.hover",
                opacity: p.connected ? 1 : 0.45,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: p.id === userId ? 700 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                  {p.id === userId ? " (you)" : ""}
                </Typography>
                {p.isHost ? (
                  <Chip
                    label="host"
                    size="small"
                    sx={{ height: 18, fontSize: "0.6rem", bgcolor: "rgba(255,215,106,0.16)", color: "#ffd76a" }}
                  />
                ) : null}
                {!p.connected ? (
                  <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                    away
                  </Typography>
                ) : null}
              </Stack>

              {ready ? (
                <Typography variant="caption" sx={{ color: "success.main", fontWeight: 700 }}>
                  ✓ {readyLabel}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
