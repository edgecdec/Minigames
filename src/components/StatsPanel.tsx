"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export interface StatRow {
  label: string;
  value: string | number;
  /** Optional context, e.g. an expected value to compare against. */
  hint?: string;
}

/**
 * Lifetime / cumulative stats, as distinct from <ScoreBar> which shows the
 * current run. Pair with useLifetimeStats.
 */
export default function StatsPanel({
  rows,
  title = "Lifetime stats",
  loaded = true,
}: {
  rows: StatRow[];
  title?: string;
  loaded?: boolean;
}) {
  if (!loaded) return null;

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
          textAlign: "center",
        }}
      >
        📊 {title}
      </Typography>

      <Stack spacing={0.75}>
        {rows.map((r) => (
          <Box
            key={r.label}
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              px: 1.5,
              py: 0.6,
              borderRadius: 1,
              bgcolor: "action.hover",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {r.label}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="baseline">
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {r.value}
              </Typography>
              {r.hint ? (
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
                  {r.hint}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
