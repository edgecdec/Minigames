"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { RoomPaused, RoomPlayer } from "@/lib/useRoom";

/**
 * Shown whenever a room is frozen. Shared by every multiplayer game, because the
 * server can pause any room — a deploy restart pauses all of them at once.
 *
 * Only the host gets the Resume button, matching the server's rule, so a
 * non-host isn't offered a control that would be rejected.
 */
export default function PauseBanner({
  paused,
  players,
  isHost,
  onResume,
}: {
  paused: RoomPaused;
  players: RoomPlayer[];
  isHost: boolean;
  onResume: () => void;
}) {
  const who = paused.by ? players.find((p) => p.id === paused.by)?.name : null;

  const headline =
    paused.reason === "restart"
      ? "Paused — the server restarted"
      : who
        ? `Paused by ${who}`
        : "Paused";

  const detail =
    paused.reason === "restart"
      ? "Your game was saved. Nobody's clock is running."
      : "Nobody's clock is running.";

  return (
    <Alert
      severity="info"
      sx={{ width: "100%" }}
      action={
        isHost ? (
          <Button size="small" variant="contained" onClick={onResume}>
            Resume
          </Button>
        ) : undefined
      }
    >
      <Stack spacing={0.25}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          ⏸ {headline}
        </Typography>
        <Typography variant="caption">
          {detail}
          {isHost ? "" : " Waiting for the host to resume."}
        </Typography>
      </Stack>
    </Alert>
  );
}
