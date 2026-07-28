"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LeaderboardEntry } from "@/lib/useLocalStorage";

const RANK_BADGES = ["🥇", "🥈", "🥉"];

export interface LeaderboardProps {
  entries: LeaderboardEntry[];
  title?: string;
  unit?: string;
  loaded?: boolean;
}

export default function Leaderboard({
  entries,
  title = "Leaderboard",
  unit = "pts",
  loaded = true,
}: LeaderboardProps) {
  if (!loaded) return null;

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        p: 2,
        borderRadius: 2,
        bgcolor: "background.paper",
      }}
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
          textAlign: "center",
        }}
      >
        🏆 {title}
      </Typography>

      {entries.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ textAlign: "center", py: 1, fontStyle: "italic", fontSize: "0.85rem" }}
        >
          No scores recorded yet. Set a record!
        </Typography>
      ) : (
        <Stack spacing={1}>
          {entries.map((entry, index) => {
            const badge = RANK_BADGES[index] ?? `#${index + 1}`;
            return (
              <Box
                key={entry.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  bgcolor: index === 0 ? "rgba(124, 92, 255, 0.08)" : "action.hover",
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      minWidth: 28,
                      textAlign: "center",
                      fontSize: index < 3 ? "1rem" : "0.8rem",
                      color: index < 3 ? "inherit" : "text.secondary",
                    }}
                  >
                    {badge}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{ fontWeight: index === 0 ? 700 : 500 }}
                  >
                    {entry.name || `Run ${index + 1}`}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: index === 0 ? "primary.main" : "text.primary",
                    }}
                  >
                    {entry.score} {unit}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontSize: "0.7rem" }}
                  >
                    {entry.date}
                  </Typography>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
