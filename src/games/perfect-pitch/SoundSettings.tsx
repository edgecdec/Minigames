"use client";

import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import VolumeDownIcon from "@mui/icons-material/VolumeDown";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { type Waveform, WAVEFORMS } from "./logic";

/**
 * Volume and timbre. Timbre is here mostly so the tone can be checked against
 * different speakers — a saw wave is genuinely harder to match than a sine, so
 * every guess records which one produced it and the two never get averaged
 * together in the history.
 */
export default function SoundSettings({
  volume,
  onVolume,
  waveform,
  onWaveform,
}: {
  volume: number;
  onVolume: (value: number) => void;
  waveform: Waveform;
  onWaveform: (value: Waveform) => void;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2, borderRadius: 3, bgcolor: "background.paper" }}
    >
      <Stack spacing={1.75}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <VolumeDownIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <Slider
            value={volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(_, v) => onVolume(v as number)}
            aria-label="Volume"
            sx={{ flex: 1 }}
          />
          <VolumeUpIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </Stack>

        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography variant="body2" color="text.secondary">
            Waveform
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={waveform}
            onChange={(_, v: Waveform | null) => v && onWaveform(v)}
          >
            {WAVEFORMS.map((w) => (
              <ToggleButton key={w.value} value={w.value} sx={{ px: 1.75 }}>
                {w.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        {waveform !== "sine" ? (
          <Typography variant="caption" color="text.secondary">
            Harmonically rich tones are harder to match. These rounds are tagged
            separately so they don&apos;t skew your sine history.
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
