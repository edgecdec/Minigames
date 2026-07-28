"use client";

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import BandChart from "@/components/charts/BandChart";
import { ChartCard } from "@/components/charts/ChartFrame";
import Histogram from "@/components/charts/Histogram";
import LineChart from "@/components/charts/LineChart";
import StatsPanel from "@/components/StatsPanel";
import {
  type Guess,
  type RunRecord,
  OCTAVE_CENTS,
  RANGE_CENTS,
  ROUNDS,
  anchoringPull,
  binByRegister,
  centsAtHz,
  formatCents,
  hzAtCents,
  nearestNote,
  signedHistogram,
  summarize,
} from "./logic";

/** Enough guesses for a per-register breakdown to say anything at all. */
const REGISTER_MIN_GUESSES = 15;

/** Bins across the range. Eight keeps each one wide enough to fill up. */
const REGISTER_BINS = 8;

function download(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PitchStats({
  guesses,
  runs,
  onClear,
}: {
  guesses: Guess[];
  runs: RunRecord[];
  onClear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => summarize(guesses), [guesses]);
  const anchoring = useMemo(() => anchoringPull(guesses), [guesses]);

  // Only present on rounds played since trajectory capture landed.
  const traced = useMemo(() => guesses.filter((g) => g.traj), [guesses]);
  const meanReversals = useMemo(
    () =>
      traced.length
        ? traced.reduce((a, g) => a + (g.traj?.reversals ?? 0), 0) / traced.length
        : 0,
    [traced],
  );
  const bands = useMemo(
    () =>
      binByRegister(guesses, REGISTER_BINS).map((b) => ({
        x: centsAtHz(b.centerHz),
        mean: b.mean,
        sd: b.sd,
        n: b.n,
      })),
    [guesses],
  );
  const scatter = useMemo(
    () => guesses.map((g) => ({ x: centsAtHz(g.targetHz), y: g.cents })),
    [guesses],
  );
  const histogram = useMemo(() => signedHistogram(guesses, 40, 400), [guesses]);
  const runScores = useMemo(
    () => runs.map((r) => r.totalScore / ROUNDS),
    [runs],
  );

  // One tick per octave boundary, derived so it tracks the range rather than
  // silently going wrong if the range ever changes again.
  const octaveTicks = useMemo(
    () =>
      Array.from({ length: RANGE_CENTS / OCTAVE_CENTS + 1 }, (_, i) => ({
        value: i * OCTAVE_CENTS,
        label: nearestNote(hzAtCents(i * OCTAVE_CENTS)).name,
      })),
    [],
  );

  if (guesses.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{ width: "100%", p: 4, borderRadius: 3, textAlign: "center", bgcolor: "background.paper" }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Nothing to plot yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Finish a round and your history starts building here.
        </Typography>
      </Paper>
    );
  }

  const biasLine =
    Math.abs(stats.bias) < 5
      ? "No consistent lean — your misses cancel out."
      : `You lean ${stats.bias > 0 ? "sharp" : "flat"} by ${Math.abs(
          Math.round(stats.bias),
        )}¢ on average.`;

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <StatsPanel
        title="All time"
        rows={[
          { label: "Rounds played", value: stats.rounds, hint: `${runs.length} runs` },
          { label: "Average error", value: `${Math.round(stats.meanAbsCents)}¢` },
          { label: "Median error", value: `${Math.round(stats.medianAbsCents)}¢` },
          { label: "Best ever", value: `${Math.round(stats.bestAbsCents)}¢` },
          {
            label: "Within a semitone",
            value: `${Math.round(stats.withinSemitone * 100)}%`,
          },
          {
            label: "Average score",
            value: `${stats.meanScore.toFixed(2)} / 10`,
          },
          { label: "Octave slips", value: stats.octaveErrors },
          {
            label: "Bias",
            value: `${formatCents(stats.bias)}¢`,
            hint: `±${Math.round(stats.spread)}¢ spread`,
          },
          ...(traced.length >= 5
            ? [
                {
                  label: "Second guesses",
                  value: meanReversals.toFixed(1),
                  hint: "direction changes per round",
                },
              ]
            : []),
          // The starting position is random and independent of the target, so
          // any relationship between them is a real anchoring effect.
          ...(anchoring
            ? [
                {
                  label: "Pull toward your start",
                  value: `${(anchoring.slope * 100).toFixed(1)}%`,
                  hint:
                    Math.abs(anchoring.r) < 0.15
                      ? "no real effect"
                      : `r ${anchoring.r.toFixed(2)} over ${anchoring.n} rounds`,
                },
              ]
            : []),
        ]}
      />

      {runScores.length >= 2 ? (
        <ChartCard
          title="Accuracy over time"
          hint="Average score per run, with a five-run trend"
        >
          <LineChart
            points={runScores}
            yMin={0}
            yMax={10}
            formatY={(v) => v.toFixed(0)}
            trendWindow={5}
          />
        </ChartCard>
      ) : null}

      {guesses.length >= REGISTER_MIN_GUESSES ? (
        <ChartCard
          title="Error by register"
          hint={`${biasLine} Shaded band is ±1 standard deviation.`}
        >
          <BandChart
            bands={bands}
            scatter={scatter}
            xDomain={[0, RANGE_CENTS]}
            xTicks={octaveTicks}
            formatY={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}¢`}
          />
          <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              above the line = guessed sharp
            </Typography>
            <Typography variant="caption" color="text.secondary">
              below = flat
            </Typography>
          </Stack>
        </ChartCard>
      ) : (
        <Paper
          elevation={0}
          sx={{ p: 2, borderRadius: 3, bgcolor: "background.paper", textAlign: "center" }}
        >
          <Typography variant="body2" color="text.secondary">
            {REGISTER_MIN_GUESSES - guesses.length} more rounds and the
            per-register breakdown unlocks.
          </Typography>
        </Paper>
      )}

      <ChartCard
        title="Where your misses land"
        hint="Signed error, everything past ±400¢ folded into the end bars"
      >
        <Histogram
          bars={histogram}
          divergeAt={0}
          formatX={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`}
        />
      </ChartCard>

      <Box>
        <Stack direction="row" spacing={1} justifyContent="center">
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() =>
              download("perfect-pitch-history.json", { runs, guesses })
            }
          >
            Export
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setConfirming(true)}
          >
            Reset history
          </Button>
        </Stack>
      </Box>

      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Erase your history?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This deletes all {stats.rounds} rounds and {runs.length} runs stored
            in this browser. It cannot be undone — export first if you want to
            keep them.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              onClear();
              setConfirming(false);
            }}
          >
            Erase everything
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
