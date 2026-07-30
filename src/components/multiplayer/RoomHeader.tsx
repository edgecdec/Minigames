"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

/** Room code with copy-to-clipboard, plus leave. Shared by all lobbies. */
export default function RoomHeader({
  roomCode,
  connected,
  onLeave,
}: {
  roomCode: string;
  connected: boolean;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked without HTTPS or permission — the code is on
      // screen anyway, so this is cosmetic.
    }
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
          <Tooltip title={copied ? "Copied" : "Click to copy"} placement="right">
            <Typography
              onClick={copy}
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
        </Stack>

        <Stack spacing={1} alignItems="flex-end">
          <Typography
            variant="caption"
            sx={{ color: connected ? "success.main" : "warning.main", fontWeight: 700 }}
          >
            {connected ? "● connected" : "● reconnecting…"}
          </Typography>
          <Button size="small" onClick={onLeave} sx={{ color: "text.secondary" }}>
            Leave
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
