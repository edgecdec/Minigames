"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import ShareIcon from "@mui/icons-material/Share";
import LinkIcon from "@mui/icons-material/Link";
import Typography from "@mui/material/Typography";

/** Room code with copy-to-clipboard, plus leave. Shared by all lobbies. */
export default function RoomHeader({
  roomCode,
  connected,
  onLeave,
  onPause,
  canPause,
}: {
  roomCode: string;
  connected: boolean;
  onLeave: () => void;
  /** Host-only pause. Omitted when there's no game running to freeze. */
  onPause?: () => void;
  canPause?: boolean;
}) {
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }

  /**
   * A link that lands straight in this room. Read from window at click time
   * rather than render time so it can't be baked wrong during SSR.
   */
  function joinUrl(): string {
    return `${window.location.origin}/multiplayer?room=${roomCode}`;
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      flash("Room code copied");
    } catch {
      // Clipboard needs HTTPS and permission; the code is on screen regardless.
      flash("Couldn't copy — the code is above");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl());
      flash("Invite link copied");
    } catch {
      flash("Couldn't copy the link");
    }
  }

  /**
   * Native share sheet where it exists (phones, mostly), clipboard elsewhere.
   * A cancelled share throws AbortError, which is not an error worth reporting.
   */
  async function share() {
    const url = joinUrl();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Minigames",
          text: `Join my game — room ${roomCode}`,
          url,
        });
        return;
      } catch {
        // Cancelled, or the sheet failed; fall through to the clipboard.
      }
    }
    await copyLink();
  }

  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        p: 2,
        borderRadius: 2,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "rgba(124,92,255,0.14)",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack spacing={0.25}>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontSize: "0.65rem",
            }}
          >
            Room code
          </Typography>
          <Tooltip title="Click to copy the code" placement="right">
            <Typography
              onClick={copyCode}
              sx={{
                fontWeight: 900,
                fontSize: "1.75rem",
                letterSpacing: "0.2em",
                lineHeight: 1.1,
                cursor: "pointer",
                userSelect: "all",
                color: "primary.main",
              }}
            >
              {roomCode}
            </Typography>
          </Tooltip>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
            <Button
              size="small"
              startIcon={<ShareIcon fontSize="small" />}
              onClick={share}
              sx={{ color: "primary.main" }}
            >
              Share
            </Button>
            <Button
              size="small"
              startIcon={<LinkIcon fontSize="small" />}
              onClick={copyLink}
              sx={{ color: "text.secondary" }}
            >
              Copy link
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={1} alignItems="flex-end">
          <Typography
            variant="caption"
            sx={{ color: connected ? "success.main" : "warning.main", fontWeight: 700 }}
          >
            {connected ? "● connected" : "● reconnecting…"}
          </Typography>
          <Stack direction="row" spacing={0.5}>
            {canPause && onPause ? (
              <Button size="small" onClick={onPause} sx={{ color: "text.secondary" }}>
                Pause
              </Button>
            ) : null}
            <Button size="small" onClick={onLeave} sx={{ color: "text.secondary" }}>
              Leave
            </Button>
          </Stack>
        </Stack>
      </Stack>

      {toast ? (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 1, color: "success.main", fontWeight: 700 }}
        >
          {toast}
        </Typography>
      ) : null}
    </Paper>
  );
}
