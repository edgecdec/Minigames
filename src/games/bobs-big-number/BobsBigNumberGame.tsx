"use client";

import { useState, useTransition } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import SendIcon from "@mui/icons-material/Send";
import ReplayIcon from "@mui/icons-material/Replay";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import ScoreBar from "@/components/ScoreBar";
import GameSidebar, { type SidebarConfig } from "@/components/GameSidebar";
import { useGlobalLeaderboard } from "@/lib/useGlobalLeaderboard";
import { useBestScore } from "@/lib/useLocalStorage";

// Scored by deepest level reached, not by the guessed number.
const SIDEBAR: SidebarConfig<Record<string, number>> = {
  global: { title: "Deepest levels", unit: "lvl" },
};
import {
  BobsBigNumberState,
  MAX_LEVEL,
  MAX_NUMBER,
  BobExpression,
  calculateMidpoint,
  createInitialState,
  formatBigInt,
  submitGuess,
} from "./logic";

const ASCII_BOB: Record<BobExpression, { speech: string; monkey: string }> = {
  thinking: {
    speech: "Ooh ooh ah ah! I'm thinking of a big number!",
    monkey: `   c_  _b
  (  o.o  )  🐵 Bob
   \\  =  /
   /|   |\\`,
  },
  higher: {
    speech: "HIGHER! Go bigger! 📈",
    monkey: `   c_  _b
  (  ⊙.⊙  )☝️ 🐵 Bob
   \\  o  /
   /|   |\\`,
  },
  lower: {
    speech: "LOWER! Go smaller! 📉",
    monkey: `   c_  _b
  (  o.o  )👇 🐵 Bob
   \\  u  /
   /|   |\\`,
  },
  win: {
    speech: "UNBELIEVABLE! YOU GUESSED IT! 🍌🎉",
    monkey: ` 🍌 c_  _b 🍌
  (  ★.★  )   🐵 Bob
   \\  ▽  /
  /|  🍌 |\\`,
  },
  lose: {
    speech: "Out of guesses! Bob wins this round! 🐵",
    monkey: `   c_  _b
  (  x.x  )   🐵 Bob
   \\  ~  /
   /|   |\\`,
  },
};

export default function BobsBigNumberGame() {
  const [bestLevel, setBestLevel, loadedBest] = useBestScore("bobs-big-number");
  const globalBoard = useGlobalLeaderboard("bobs-big-number");
  const [state, setState] = useState<BobsBigNumberState>(() => createInitialState({ level: 1 }));
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [, startTransition] = useTransition();

  const currentMidpoint = calculateMidpoint(state.minRange, state.maxRange);

  const handleUseMidpoint = () => {
    setInputValue(formatBigInt(currentMidpoint));
    setInputError("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, "");
    if (raw === "") {
      setInputValue("");
      setInputError("");
      return;
    }

    if (!/^\d+$/.test(raw)) {
      setInputValue(e.target.value);
      setInputError("Please enter a valid positive integer");
      return;
    }

    try {
      const val = BigInt(raw);
      setInputValue(formatBigInt(val));
      setInputError("");
    } catch {
      setInputError("Number too large");
    }
  };

  const handleGuessSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.status !== "playing") return;

    const raw = inputValue.replace(/,/g, "");
    if (!raw || !/^\d+$/.test(raw)) {
      setInputError("Enter a valid number to guess!");
      return;
    }

    try {
      const guess = BigInt(raw);
      const nextState = submitGuess(state, guess);
      setState(nextState);
      setInputValue("");
      setInputError("");

      if (nextState.status === "won") {
        setBestLevel(nextState.level);
      }
    } catch {
      setInputError("Invalid number!");
    }
  };

  const handleNextLevel = () => {
    const nextLevel = Math.min(MAX_LEVEL, state.level + 1);
    startTransition(() => {
      setState(createInitialState({ level: nextLevel }));
      setInputValue("");
      setInputError("");
    });
  };

  const handleRestartLevel = () => {
    startTransition(() => {
      setState(createInitialState({ level: state.level }));
      setInputValue("");
      setInputError("");
    });
  };

  // Calculate search space reduction %
  const totalDigits = MAX_NUMBER.toString().length;
  const currentDiff = state.maxRange - state.minRange + BigInt(1);
  const remainingDigits = currentDiff.toString().length;
  const rangeNarrowPercent = Math.min(
    100,
    Math.max(0, Math.round(((totalDigits - remainingDigits) / totalDigits) * 100)),
  );

  const bobArt = ASCII_BOB[state.expression];

  return (
    <Stack spacing={2} sx={{ width: "100%", alignItems: "center" }}>
      <ScoreBar
        stats={[
          { label: "Level", value: `${state.level} / ${MAX_LEVEL}` },
          { label: "Guesses Left", value: `${state.guessesLeft} / ${state.maxGuessesForLevel}` },
          { label: "Best Passed", value: bestLevel > 0 ? `Lvl ${bestLevel}` : "-", muted: !loadedBest },
        ]}
      />

      {/* ASCII Art Box */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          width: "100%",
          bgcolor: "background.paper",
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack spacing={2} alignItems="center">
          {/* Speech Bubble */}
          <Box
            sx={{
              p: 1.5,
              px: 2.5,
              borderRadius: 3,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              textAlign: "center",
              position: "relative",
              maxWidth: "100%",
              boxShadow: 2,
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
              {bobArt.speech}
            </Typography>
          </Box>

          {/* ASCII Monkey */}
          <Typography
            component="pre"
            sx={{
              fontFamily: "monospace",
              fontSize: "1rem",
              lineHeight: 1.2,
              fontWeight: 800,
              color: "text.primary",
              m: 0,
            }}
          >
            {bobArt.monkey}
          </Typography>
        </Stack>
      </Paper>

      {/* Range Status & Progress */}
      <Card sx={{ width: "100%", borderRadius: 3 }}>
        <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                CURRENT SEARCH RANGE:
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  wordBreak: "break-all",
                  mt: 0.5,
                }}
              >
                {formatBigInt(state.minRange)} ➔ {formatBigInt(state.maxRange)}
              </Typography>
            </Box>

            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Range Narrowed
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  {rangeNarrowPercent}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={rangeNarrowPercent}
                sx={{ height: 8, borderRadius: 4 }}
              />
            </Box>

            {/* Input & Action Form */}
            {state.status === "playing" && (
              <Box component="form" onSubmit={handleGuessSubmit} sx={{ mt: 1 }}>
                <Stack spacing={1.5}>
                  <TextField
                    fullWidth
                    label="Enter your guess"
                    placeholder="e.g. 500,000,000,000,000,000,000"
                    value={inputValue}
                    onChange={handleInputChange}
                    error={Boolean(inputError)}
                    helperText={inputError}
                    slotProps={{
                      htmlInput: { style: { fontFamily: "monospace", fontWeight: 600 } },
                    }}
                  />

                  <Stack direction="row" spacing={1}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="secondary"
                      startIcon={<AutoFixHighIcon />}
                      onClick={handleUseMidpoint}
                      sx={{ py: 1.2 }}
                    >
                      Split Difference
                    </Button>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={<SendIcon />}
                      disabled={!inputValue}
                      sx={{ px: 3, py: 1.2, fontWeight: 700 }}
                    >
                      Guess
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}

            {/* Win State Actions */}
            {state.status === "won" && (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: "success.dark",
                    color: "white",
                    borderRadius: 2,
                    textAlign: "center",
                  }}
                >
                  <Typography variant="h6" fontWeight={800}>
                    Level {state.level} Passed! 🎉
                  </Typography>
                  <Typography variant="body2">
                    {state.level < MAX_LEVEL
                      ? `Ready for Level ${state.level + 1}? You'll get ${state.maxGuessesForLevel - 1} guesses!`
                      : "YOU HAVE CONQUERED ALL 70 LEVELS! YOU ARE THE ULTIMATE NUMBER MASTER!"}
                  </Typography>
                </Paper>

                {state.level < MAX_LEVEL ? (
                  <Button
                    variant="contained"
                    color="success"
                    size="large"
                    endIcon={<ArrowForwardIcon />}
                    onClick={handleNextLevel}
                    sx={{ py: 1.5, fontWeight: 800 }}
                  >
                    Play Level {state.level + 1}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<ReplayIcon />}
                    onClick={() => setState(createInitialState({ level: 1 }))}
                    sx={{ py: 1.5, fontWeight: 800 }}
                  >
                    Play Again from Level 1
                  </Button>
                )}
              </Stack>
            )}

            {/* Lose State Actions */}
            {state.status === "lost" && (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: "error.dark",
                    color: "white",
                    borderRadius: 2,
                    textAlign: "center",
                  }}
                >
                  <Typography variant="h6" fontWeight={800}>
                    Out of Guesses! 💥
                  </Typography>
                  <Typography variant="body2">
                    Bob's secret target was: {formatBigInt(state.target)}
                  </Typography>
                </Paper>

                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  startIcon={<ReplayIcon />}
                  onClick={handleRestartLevel}
                  sx={{ py: 1.5, fontWeight: 800 }}
                >
                  Retry Level {state.level}
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* History Log */}
      {state.history.length > 0 && (
        <Card sx={{ width: "100%", borderRadius: 3 }}>
          <CardContent sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 700 }}>
              GUESS HISTORY
            </Typography>
            <Stack spacing={1} sx={{ maxHeight: 200, overflowY: "auto" }}>
              {state.history.map((item, index) => (
                <Stack
                  key={`${index}-${item.guess.toString()}`}
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{
                    p: 1,
                    px: 1.5,
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: "monospace", fontWeight: 600, wordBreak: "break-all" }}
                  >
                    #{state.history.length - index}: {formatBigInt(item.guess)}
                  </Typography>
                  <Chip
                    size="small"
                    label={
                      item.result === "correct"
                        ? "CORRECT 🎉"
                        : item.result === "higher"
                        ? "HIGHER 📈"
                        : "LOWER 📉"
                    }
                    color={
                      item.result === "correct"
                        ? "success"
                        : item.result === "higher"
                        ? "warning"
                        : "info"
                    }
                    sx={{ fontWeight: 700, fontSize: "0.7rem" }}
                  />
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <GameSidebar
        config={SIDEBAR}
        global={globalBoard}
        // Post on a cleared level; the level number IS the score.
        pendingScore={state.status === "won" ? state.level : null}
      />
    </Stack>
  );
}
