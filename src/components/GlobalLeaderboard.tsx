"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAX_NAME_LENGTH } from "@/lib/names";
import type { BoardEntry, MyEntry } from "@/lib/useGlobalLeaderboard";

const RANK_BADGES = ["🥇", "🥈", "🥉"];

/**
 * Server-backed board, shared by every game. Games pass data straight from
 * useGlobalLeaderboard — no game supplies its own markup.
 */
export default function GlobalLeaderboard({
  entries,
  me,
  loading,
  error,
  name,
  unit = "pts",
  title = "Global leaderboard",
  pendingScore,
  onSubmit,
}: {
  entries: BoardEntry[];
  me: MyEntry | null;
  loading?: boolean;
  error?: string | null;
  name: string;
  unit?: string;
  title?: string;
  /** Set when a finished run is waiting to be posted; shows the name prompt. */
  pendingScore?: number | null;
  onSubmit?: (score: number, name: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const showPrompt =
    typeof pendingScore === "number" && pendingScore > 0 && !done && !!onSubmit;

  async function handleSubmit() {
    if (!onSubmit || typeof pendingScore !== "number") return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    const ok = await onSubmit(pendingScore, trimmed);
    setBusy(false);
    if (ok) setDone(true);
  }

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
        🌍 {title}
      </Typography>

      {showPrompt ? (
        <Stack spacing={1} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ textAlign: "center" }}>
            Post <b>{pendingScore.toLocaleString()}</b> {unit} to the global board?
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Your name"
              // Server truncates too; this just prevents wasted round-trips.
              slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={busy || draft.trim() === ""}
            >
              {busy ? "…" : "Post"}
            </Button>
          </Stack>
          <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
            Max {MAX_NAME_LENGTH} characters. No account needed.
          </Typography>
        </Stack>
      ) : null}

      {error ? (
        <Typography
          variant="body2"
          sx={{ textAlign: "center", py: 1, color: "text.secondary", fontStyle: "italic" }}
        >
          {error}
        </Typography>
      ) : loading ? (
        <Typography
          variant="body2"
          sx={{ textAlign: "center", py: 1, color: "text.secondary", fontStyle: "italic" }}
        >
          Loading…
        </Typography>
      ) : entries.length === 0 ? (
        <Typography
          variant="body2"
          sx={{ textAlign: "center", py: 1, color: "text.secondary", fontStyle: "italic" }}
        >
          Nobody has posted a score yet. Be first!
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {entries.map((e) => (
            <Box
              key={`${e.rank}-${e.name}`}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                bgcolor: e.isYou ? "rgba(124,92,255,0.16)" : "action.hover",
                border: e.isYou ? "1px solid" : "none",
                borderColor: "primary.main",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    minWidth: 28,
                    textAlign: "center",
                    fontSize: e.rank <= 3 ? "1rem" : "0.8rem",
                    color: e.rank <= 3 ? "inherit" : "text.secondary",
                  }}
                >
                  {RANK_BADGES[e.rank - 1] ?? `#${e.rank}`}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: e.isYou ? 700 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.name}
                  {e.isYou ? " (you)" : ""}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ fontWeight: 700, flexShrink: 0, ml: 1 }}>
                {e.score.toLocaleString()} {unit}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}

      {me && !entries.some((e) => e.isYou) ? (
        <Typography
          variant="caption"
          sx={{ display: "block", textAlign: "center", mt: 1.5, color: "text.secondary" }}
        >
          Your best: {me.score.toLocaleString()} {unit} · rank #{me.rank}
        </Typography>
      ) : null}
    </Paper>
  );
}
