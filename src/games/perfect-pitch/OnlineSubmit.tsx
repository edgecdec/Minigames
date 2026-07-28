"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PublicIcon from "@mui/icons-material/Public";
import { MAX_NAME_LENGTH } from "@/lib/names";
import { ROUNDS } from "./logic";
import type { SubmitOutcome } from "./useOnlineRun";

/**
 * Posts a finished server-scored run to the global board.
 *
 * Perfect Pitch doesn't use the shared submit prompt, because that one posts a
 * score the client calculated. Here the score already exists on the server —
 * this only attaches a name to it.
 */
export default function OnlineSubmit({
  total,
  name,
  busy,
  onSubmit,
}: {
  total: number;
  name: string;
  busy: boolean;
  onSubmit: (name: string) => Promise<SubmitOutcome | null>;
}) {
  const [draft, setDraft] = useState(name);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [failed, setFailed] = useState(false);

  async function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setFailed(false);
    const result = await onSubmit(trimmed);
    if (!result) {
      setFailed(true);
      return;
    }
    setOutcome(result);
  }

  if (outcome) {
    if (!outcome.verified) {
      return (
        <Alert severity="warning" sx={{ width: "100%" }}>
          This run didn&apos;t pass the plausibility checks, so it isn&apos;t
          ranked. If that seems wrong, play another — the checks look at how the
          ribbon moved, and a very fast, very direct run can trip them.
        </Alert>
      );
    }
    return (
      <Alert severity="success" sx={{ width: "100%" }}>
        {outcome.accepted
          ? `Posted to the global board as ${outcome.name}.`
          : `Kept your better run — this one didn't beat it.`}
      </Alert>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2, borderRadius: 3, bgcolor: "background.paper" }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ textAlign: "center" }}>
          Post <b>{total.toFixed(1)}</b> / {ROUNDS * 10} to the global board?
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="Your name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
          />
          <Button
            variant="contained"
            startIcon={<PublicIcon />}
            disabled={busy || !draft.trim()}
            onClick={handleSubmit}
          >
            Post
          </Button>
        </Stack>
        {failed ? (
          <Typography variant="caption" color="error">
            Couldn&apos;t reach the board. Your run is safe — try again.
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
