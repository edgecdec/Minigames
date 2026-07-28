"use client";

import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export interface Stat {
  label: string;
  value: string | number;
  /** Dims the value — used for a best score that hasn't loaded from storage yet. */
  muted?: boolean;
}

/** Row of stat readouts (score, best, streak, ...) shared by all games. */
export default function ScoreBar({ stats }: { stats: Stat[] }) {
  return (
    <Paper
      elevation={0}
      sx={{
        px: 2,
        py: 1.25,
        width: "100%",
        borderRadius: 2,
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={2} justifyContent="space-around">
        {stats.map((s) => (
          <Stack key={s.label} spacing={0.25} alignItems="center">
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontSize: "0.65rem",
              }}
            >
              {s.label}
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, opacity: s.muted ? 0.4 : 1, lineHeight: 1.2 }}
            >
              {s.value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
