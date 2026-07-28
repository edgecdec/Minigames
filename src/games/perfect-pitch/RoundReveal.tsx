"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import {
  type Guess,
  detectOctaveError,
  formatCents,
  formatHz,
  nearestNote,
  tierForCents,
} from "./logic";

function scoreColour(score: number): string {
  if (score >= 8.5) return "success.main";
  if (score >= 6) return "secondary.main";
  if (score >= 3) return "warning.main";
  return "error.main";
}

function ToneReadout({
  label,
  hz,
  colour,
}: {
  label: string;
  hz: number;
  colour: string;
}) {
  const note = nearestNote(hz);
  return (
    <Box sx={{ flex: 1, textAlign: "center" }}>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          fontSize: "0.62rem",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: "1.5rem",
          color: colour,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
        }}
      >
        {formatHz(hz)}
        <Box component="span" sx={{ fontSize: "0.75rem", ml: 0.5, opacity: 0.7 }}>
          Hz
        </Box>
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {note.name} {formatCents(note.centsOff)}¢
      </Typography>
    </Box>
  );
}

/** Phase three: the number finally appears, along with how badly you missed. */
export default function RoundReveal({
  guess,
  round,
  totalRounds,
  onPlayTarget,
  onPlayGuess,
  onNext,
  nextLabel,
}: {
  guess: Guess;
  round: number;
  totalRounds: number;
  onPlayTarget: () => void;
  onPlayGuess: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  const octave = detectOctaveError(guess.cents);
  const colour = scoreColour(guess.score);
  const direction = guess.cents > 0 ? "sharp" : "flat";

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        p: 2.5,
        borderRadius: 3,
        bgcolor: "background.paper",
        animation: "reveal-rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "@keyframes reveal-rise": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "none" },
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack spacing={2}>
        <Stack alignItems="center" spacing={0.5}>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontSize: "0.62rem",
            }}
          >
            Round {round} of {totalRounds}
          </Typography>
          <Typography
            sx={{
              fontSize: "3.4rem",
              fontWeight: 900,
              lineHeight: 1,
              color: colour,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {guess.score.toFixed(1)}
            <Box component="span" sx={{ fontSize: "1.1rem", opacity: 0.55 }}>
              {" "}
              / 10
            </Box>
          </Typography>
          <Typography sx={{ fontWeight: 700, color: colour }}>
            {tierForCents(guess.cents)}
          </Typography>
        </Stack>

        {octave ? (
          <Chip
            label={`⚠ ${octave.label}`}
            sx={{
              alignSelf: "center",
              fontWeight: 700,
              bgcolor: "rgba(255,181,71,0.14)",
              color: "warning.main",
              border: "1px solid",
              borderColor: "warning.main",
            }}
          />
        ) : null}

        <Stack direction="row" alignItems="flex-start">
          <ToneReadout label="Target" hz={guess.targetHz} colour="success.main" />
          <Box sx={{ px: 1, textAlign: "center", minWidth: 96 }}>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: "1.5rem",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
              }}
            >
              {formatCents(guess.cents)}¢
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {Math.round(Math.abs(guess.cents)) === 0 ? "spot on" : direction}
            </Typography>
          </Box>
          <ToneReadout label="You" hz={guess.guessHz} colour="warning.main" />
        </Stack>

        <Stack direction="row" spacing={1} justifyContent="center">
          <Button
            size="small"
            variant="outlined"
            startIcon={<GraphicEqIcon />}
            onClick={onPlayTarget}
            sx={{ color: "success.main", borderColor: "success.main" }}
          >
            Target
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<GraphicEqIcon />}
            onClick={onPlayGuess}
            sx={{ color: "warning.main", borderColor: "warning.main" }}
          >
            Yours
          </Button>
        </Stack>

        <Button variant="contained" size="large" onClick={onNext} fullWidth>
          {nextLabel}
        </Button>
      </Stack>
    </Paper>
  );
}
