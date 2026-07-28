"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ReplayIcon from "@mui/icons-material/Replay";
import InsightsIcon from "@mui/icons-material/Insights";
import {
  type Guess,
  ROUNDS,
  formatCents,
  formatHz,
  summarize,
} from "./logic";

/** One bar per round, height by score. The shape of a run at a glance. */
function RoundStrip({ guesses }: { guesses: Guess[] }) {
  return (
    <Stack direction="row" spacing={1} sx={{ width: "100%", height: 92 }}>
      {guesses.map((g, i) => (
        <Stack
          key={i}
          spacing={0.5}
          sx={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}
        >
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, fontSize: "0.68rem" }}
          >
            {g.score.toFixed(1)}
          </Typography>
          <Box
            sx={{
              width: "100%",
              height: `${Math.max(4, (g.score / 10) * 100)}%`,
              borderRadius: 1,
              background: (t) =>
                `linear-gradient(180deg, ${t.palette.secondary.main}, ${t.palette.primary.main})`,
              transition: "height 500ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontSize: "0.6rem" }}
          >
            {formatHz(g.targetHz)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box sx={{ flex: "1 1 96px", textAlign: "center" }}>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: "0.6rem",
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, fontSize: "1.15rem", lineHeight: 1.3 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.62rem" }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

/** The five-round wrap-up. */
export default function RunSummary({
  guesses,
  best,
  isNewBest,
  onPlayAgain,
  onViewStats,
}: {
  guesses: Guess[];
  best: number;
  isNewBest: boolean;
  onPlayAgain: () => void;
  onViewStats: () => void;
}) {
  const stats = summarize(guesses);
  const total = guesses.reduce((a, g) => a + g.score, 0);
  const biasWord = stats.bias > 0 ? "sharp" : "flat";

  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2.5, borderRadius: 3, bgcolor: "background.paper" }}
    >
      <Stack spacing={2.5}>
        <Stack alignItems="center" spacing={0.25}>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontSize: "0.62rem",
            }}
          >
            {ROUNDS} rounds complete
          </Typography>
          <Typography
            sx={{
              fontSize: "3.6rem",
              fontWeight: 900,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              background: (t) =>
                `linear-gradient(90deg, ${t.palette.secondary.main}, ${t.palette.primary.main})`,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            {total.toFixed(1)}
            <Box component="span" sx={{ fontSize: "1.1rem", opacity: 0.5, color: "text.secondary" }}>
              {" "}
              / {ROUNDS * 10}
            </Box>
          </Typography>
          <Typography variant="body2" sx={{ color: isNewBest ? "success.main" : "text.secondary", fontWeight: isNewBest ? 700 : 400 }}>
            {isNewBest ? "🏆 New personal best!" : `Personal best ${best.toFixed(1)}`}
          </Typography>
        </Stack>

        <RoundStrip guesses={guesses} />

        <Stack direction="row" flexWrap="wrap" rowGap={1.5}>
          <SummaryStat
            label="Avg error"
            value={`${Math.round(stats.meanAbsCents)}¢`}
            hint={`median ${Math.round(stats.medianAbsCents)}¢`}
          />
          <SummaryStat
            label="Best round"
            value={`${Math.round(stats.bestAbsCents)}¢`}
          />
          <SummaryStat
            label="Bias"
            value={`${formatCents(stats.bias)}¢`}
            hint={Math.abs(stats.bias) < 5 ? "no lean" : `you ran ${biasWord}`}
          />
          <SummaryStat
            label="Octave slips"
            value={`${stats.octaveErrors}`}
          />
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={<ReplayIcon />}
            onClick={onPlayAgain}
          >
            Play {ROUNDS} more
          </Button>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<InsightsIcon />}
            onClick={onViewStats}
          >
            All-time stats
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
