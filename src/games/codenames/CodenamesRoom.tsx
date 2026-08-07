"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Celebration from "@/components/Celebration";
import PlayerList from "@/components/multiplayer/PlayerList";
import { MAX_WORD_LENGTH } from "./logic";
import type { RoomGameProps, RoomPlayer } from "@/lib/useRoom";

/** Mirrors publicState() in ./server.js — submissions stay hidden until reveal. */
export interface CodenamesPublicState {
  phase: "lobby" | "submitting" | "won";
  words: string[];
  round: number;
  winningWord: string | null;
  lastReveal: { userId: string; word: string }[] | null;
  usedCount: number;
  submitted: string[];
  waitingOn: number;
  /** Session-long tally: a point per other player who said your word. */
  syncPoints: Record<string, number>;
  /**
   * Who said each word on screen, keyed by the word. Several authors when players
   * agreed; empty for the opening prompt, which came from the pool.
   */
  authors: Record<string, string[]>;
  /** Points from the round just revealed. */
  lastRoundSync: Record<string, number> | null;
  /** Words on screen before this reveal, so we can say narrowed vs widened. */
  prevWordCount: number;
  playerCount: number;
  /** Increments per rematch; `round` alone restarts and would suppress reruns. */
  gameNumber: number;
}

/**
 * The prompt words. Wraps and shrinks with the count, since a 6-player round can
 * legitimately have six words on screen before the group starts converging.
 */
function PromptWords({
  words,
  authors,
  nameFor,
}: {
  words: string[];
  /** Word -> the players who submitted it. */
  authors?: Record<string, string[]>;
  nameFor: (userId: string) => string;
}) {
  const many = words.length > 3;
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="center"
      sx={{ width: "100%", flexWrap: "wrap" }}
      useFlexGap
    >
      {words.map((w, i) => {
        // Several names when players agreed on the same word — that collapse is
        // how the prompt narrows, so both authors are named. The opening prompt
        // has none: it was drawn from the pool.
        const said = authors?.[w] ?? [];
        return (
        <Box key={`${w}-${i}`} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Stack spacing={0.5} alignItems="center">
            <Typography
              variant="caption"
              sx={{
                color: said.length ? "text.secondary" : "transparent",
                fontSize: "0.65rem",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {/*
                Rendered transparent rather than omitted when nobody said the
                word, so the opening prompt lines up with later rounds instead of
                every card jumping down once authors appear.
              */}
              {said.length ? said.map(nameFor).join(" + ") : "\u00a0"}
            </Typography>
          <Paper
            elevation={0}
            sx={{
              px: many ? 1.5 : 2.5,
              py: many ? 1 : 1.5,
              borderRadius: 2,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "primary.main",
            }}
          >
            <Typography
              sx={{
                fontWeight: 900,
                fontSize: many
                  ? { xs: "1rem", sm: "1.2rem" }
                  : { xs: "1.35rem", sm: "1.75rem" },
                letterSpacing: "0.04em",
              }}
            >
              {w}
            </Typography>
          </Paper>
          </Stack>
          {i < words.length - 1 ? (
            <Typography sx={{ color: "text.secondary", fontWeight: 700 }}>+</Typography>
          ) : null}
        </Box>
        );
      })}
    </Stack>
  );
}

/**
 * Sync-point standings. Explicitly not the win condition — the group converging
 * is — so this is framed as a "who thinks alike" curiosity.
 */
function SyncBoard({
  syncPoints,
  lastRoundSync,
  players,
  userId,
}: {
  syncPoints: Record<string, number>;
  lastRoundSync: Record<string, number> | null;
  players: RoomPlayer[];
  userId: string;
}) {
  const ids = Object.keys(syncPoints);
  if (ids.length === 0) return null;

  const ranked = [...ids].sort((a, b) => syncPoints[b] - syncPoints[a]);
  const high = syncPoints[ranked[0]];
  const low = syncPoints[ranked[ranked.length - 1]];
  // With everyone level there is no "most" or "least" worth calling out.
  const spread = high !== low;

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
        🧩 In sync
      </Typography>

      <Stack spacing={0.75}>
        {ranked.map((id) => {
          const gained = lastRoundSync?.[id] ?? 0;
          const isTop = spread && syncPoints[id] === high;
          const isBottom = spread && syncPoints[id] === low;
          return (
            <Box
              key={id}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                px: 1.5,
                py: 0.6,
                borderRadius: 1,
                bgcolor: id === userId ? "rgba(124,92,255,0.14)" : "action.hover",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: id === userId ? 700 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {players.find((p) => p.id === id)?.name ?? "Player"}
                  {id === userId ? " (you)" : ""}
                </Typography>
                {isTop ? <Typography variant="caption">🧠 most</Typography> : null}
                {isBottom ? <Typography variant="caption">🎨 least</Typography> : null}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="baseline">
                {gained > 0 ? (
                  <Typography variant="caption" sx={{ color: "success.main", fontWeight: 700 }}>
                    +{gained}
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {syncPoints[id]}
                </Typography>
              </Stack>
            </Box>
          );
        })}
      </Stack>

      <Typography
        variant="caption"
        sx={{ display: "block", textAlign: "center", mt: 1.25, color: "text.secondary" }}
      >
        A point per other player who said your word. Doesn&apos;t affect winning.
      </Typography>
    </Paper>
  );
}

export default function CodenamesRoom({
  state,
  players,
  userId,
  isHost,
  send,
  roomWins,
}: RoomGameProps<CodenamesPublicState>) {
  const [word, setWord] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const iSubmitted = state.submitted.includes(userId);
  const nameFor = (id: string) =>
    id === userId ? "you" : (players.find((p) => p.id === id)?.name ?? "Player");

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
        <Typography variant="caption">
          {state.words.length}/{Math.max(state.playerCount, state.words.length)} words
        </Typography>
        <Typography variant="caption">{state.usedCount} used</Typography>
      </Stack>

      <PromptWords words={state.words} authors={state.authors} nameFor={nameFor} />

      {/*
        The outcome of the round that just ended, shown WHILE the next one is
        already open. This replaced a full reveal screen with a "Next round"
        button: the names it existed to show now sit above each word, so stopping
        the game to display them only added a click between every round.

        Only from round 2 — on round 1 there is no previous round to report.
      */}
      {state.phase === "submitting" && state.round > 1 ? (
        <Alert severity="info" sx={{ width: "100%", maxWidth: 340 }}>
          {state.words.length < state.prevWordCount
            ? `Closer — down to ${state.words.length} from ${state.prevWordCount}.`
            : state.words.length > state.prevWordCount
              ? `Scattered — back up to ${state.words.length} from ${state.prevWordCount}.`
              : `Still ${state.words.length} words. Nobody converged.`}
        </Alert>
      ) : null}

      {state.phase === "lobby" ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            One word on screen per player. Everyone secretly submits the single
            word connecting them all. Agree and the prompt shrinks — disagree and
            it can grow right back. Everyone saying the same word wins.
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

      {/*
        Converging on one word is the win, so that's the moment worth marking.
        Keyed on game+round for two reasons: a room re-broadcasts its state on
        every event, so keying on the phase alone would re-fire endlessly while
        the win screen sits there — and a rematch resets `round` to 1, so the
        round alone would make the next win look already-handled.
      */}
      <Celebration
        active={state.phase === "won"}
        celebrationKey={`won-${state.gameNumber}-${state.round}`}
      />

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

      {state.phase === "won" || (state.phase === "submitting" && state.round > 1) ? (
        <SyncBoard
          syncPoints={state.syncPoints}
          lastRoundSync={state.lastRoundSync}
          players={players}
          userId={userId}
        />
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
