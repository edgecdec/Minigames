"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAX_NAME_LENGTH } from "@/lib/names";
import { CODE_LENGTH } from "@/lib/roomCodes";

/** Create-or-join screen. Shared entry point for all multiplayer games. */
export default function RoomJoin({
  onJoin,
  connecting,
  error,
  initialName = "",
}: {
  onJoin: (roomCode: string, name: string) => void;
  connecting?: boolean;
  error?: string | null;
  initialName?: string;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");

  const nameOk = name.trim().length > 0;
  const codeOk = code.length === CODE_LENGTH;

  return (
    <Stack spacing={2.5} sx={{ width: "100%", maxWidth: 380 }}>
      <TextField
        label="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
        fullWidth
        autoComplete="off"
      />

      <Button
        variant="contained"
        size="large"
        disabled={!nameOk || connecting}
        onClick={() => onJoin("NEW", name.trim())}
      >
        {connecting ? "Connecting…" : "Create a room"}
      </Button>

      <Divider sx={{ color: "text.secondary", fontSize: "0.75rem" }}>or join one</Divider>

      <Stack direction="row" spacing={1}>
        <TextField
          label="Room code"
          value={code}
          // Codes are always upper case and never contain I/O/0/1.
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z2-9]/g, "")
                .slice(0, CODE_LENGTH),
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && nameOk && codeOk) onJoin(code, name.trim());
          }}
          slotProps={{
            htmlInput: {
              style: { textTransform: "uppercase", letterSpacing: "0.25em", fontWeight: 700 },
            },
          }}
          sx={{ flex: 1 }}
          autoComplete="off"
        />
        <Button
          variant="outlined"
          disabled={!nameOk || !codeOk || connecting}
          onClick={() => onJoin(code, name.trim())}
        >
          Join
        </Button>
      </Stack>

      {error ? <Alert severity="warning">{error}</Alert> : null}

      <Box>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          No account needed. Share the room code and play on any device.
        </Typography>
      </Box>
    </Stack>
  );
}
