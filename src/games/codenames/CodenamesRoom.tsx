"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PlayerList from "@/components/multiplayer/PlayerList";
import { MAX_WORD_LENGTH } from "./logic";
import type { RoomPlayer } from "@/lib/useRoom";

/** Mirrors publicState() in ./server.js — submissions stay hidden until reveal. */
export interface CodenamesPublicState {
  phase: "lobby" | "submitting" | "reveal" | "won";
  pair: [string, string];
  round: number;
  winningWord: string | null;
  lastReveal: { userId: string; word: string }[] | null;
  usedCount: number;
  submitted: string[];
  waitingOn: number;
}

function WordPair({ pair }: { pair: [string, string] }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      justifyContent="center"
      sx={{ width: "100%", flexWrap: "wrap" }}
      useFlexGap
    >
      {pair.map((w, i) => (
        <Box key={`${w}-${i}`} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Paper
            elevation={0}
            sx={{
              px: 2.5,
              py: 1.5,
              borderRadius: 2,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "primary.main",
            }}
          >
            <Typography
              sx={{
                fontWeight: 900,
                fontSize: { xs: "1.35rem", sm: "1.75rem" },
                letterSpacing: "0.04em",
              }}
            >
              {w}
            </Typography>
          </Paper>
          {i === 0 ? (
            <Typography sx={{ color: "text.secondary", fontWeight: 700 }}>+</Typography>
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}

export default function CodenamesRoom({
  state,
  players,
  userId,
  isHost,
  send,
}: {
  state: CodenamesPublicState;
  players: RoomPlayer[];
  userId: string;
  isHost: boolean;
  send: (event: string, data?: unknown) => void;
}) {
  const [word, setWord] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const iSubmitted = state.submitted.includes(userId);

  // Clear the box between rounds and take focus back for the next guess.
  useEffect(() => {
    if (state.phase === "submitting") {
      setWord("");
      // A frame later, so the field exists after the phase re-render.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [state.phase, state.round]);

  function submit() {
    const trimmed = word.trim();
    if (!trimmed) return;
    send("submit", { word: trimmed });
    setWord("");
  }

  return (
    <Stack spacing={2.5} sx={{ width: "100%", alignItems: "center" }}>
      <Stack direction="row" spacing={2} sx={{ color: "text.secondary" }}>
        <Typography variant="caption">Round {state.round}</Typography>
        <Typography variant="caption">{state.usedCount} words used</Typography>
      </Stack>

      <WordPair pair={state.pair} />

      {state.phase === "lobby" ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            Everyone submits the one word that connects these two.
          </Typography>
          {isHost ? (
            <Button variant="contained" size="large" onClick={() => send("start")}>
              Start
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host to start…
            </Typography>
          )}
        </Stack>
      ) : null}

      {state.phase === "submitting" ? (
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 340 }} alignItems="center">
          {iSubmitted ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 700, color: "success.main" }}>
                Locked in
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {state.waitingOn === 0
                  ? "Revealing…"
                  : `Waiting on ${state.waitingOn} more ${state.waitingOn === 1 ? "player" : "players"}`}
              </Typography>
            </>
          ) : (
            <>
              <TextField
                inputRef={inputRef}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="the connecting word"
                autoComplete="off"
                fullWidth
                slotProps={{
                  htmlInput: {
                    maxLength: MAX_WORD_LENGTH,
                    style: { textAlign: "center", fontWeight: 700 },
                  },
                }}
              />
              <Button variant="contained" onClick={submit} disabled={!word.trim()}>
                Lock it in
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
                Nobody sees your word until everyone has answered.
              </Typography>
            </>
          )}
        </Stack>
      ) : null}

      {state.phase === "reveal" && state.lastReveal ? (
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 340 }} alignItems="center">
          <Alert severity="info" sx={{ width: "100%" }}>
            No match — those two words are the new pair.
          </Alert>
          <Stack spacing={0.5} sx={{ width: "100%" }}>
            {state.lastReveal.map((r) => (
              <Stack key={r.userId} direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  {players.find((p) => p.id === r.userId)?.name ?? "Player"}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {r.word}
                </Typography>
              </Stack>
            ))}
          </Stack>
          {isHost ? (
            <Button variant="contained" onClick={() => send("continue")}>
              Next round
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host…
            </Typography>
          )}
        </Stack>
      ) : null}

      {state.phase === "won" ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 800, textAlign: "center" }}>
            🎉 {state.winningWord}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            Everyone said the same word — in {state.round}{" "}
            {state.round === 1 ? "try" : "tries"}.
          </Typography>
          {isHost ? (
            <Button variant="contained" onClick={() => send("again")}>
              Play again
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Waiting for the host…
            </Typography>
          )}
        </Stack>
      ) : null}

      <PlayerList
        players={players}
        userId={userId}
        readyIds={state.phase === "submitting" ? state.submitted : []}
        readyLabel="locked in"
      />
    </Stack>
  );
}
