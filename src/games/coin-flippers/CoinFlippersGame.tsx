"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore } from "@/lib/useLocalStorage";

const TARGET = 10;
const FLIP_MS = 450;

type Side = "H" | "T";

export default function CoinFlippersGame() {
  const [streak, setStreak] = useState(0);
  const [history, setHistory] = useState<Side[]>([]);
  const [face, setFace] = useState<Side>("H");
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [best, submitBest, bestLoaded] = useBestScore("coin-flippers");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flip = useCallback(() => {
    if (flipping) return;
    // A win is terminal — require an explicit reset so the streak isn't lost
    // to a stray keypress on the victory screen.
    if (result === "win") return;

    setFlipping(true);
    setResult(null);

    timer.current = setTimeout(() => {
      const side: Side = Math.random() < 0.5 ? "H" : "T";
      setFace(side);
      setFlipping(false);
      setHistory((h) => [...h.slice(-(TARGET - 1)), side]);

      if (side === "H") {
        const next = streak + 1;
        setStreak(next);
        submitBest(next);
        if (next >= TARGET) setResult("win");
      } else {
        submitBest(streak);
        setStreak(0);
        setResult("lose");
      }
    }, FLIP_MS);
  }, [flipping, result, streak, submitBest]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setStreak(0);
    setHistory([]);
    setResult(null);
    setFlipping(false);
    setFace("H");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (result === "win") reset();
      else flip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, reset, result]);

  const won = result === "win";

  return (
    <>
      <ScoreBar
        stats={[
          { label: "Streak", value: streak },
          { label: "Best", value: best, muted: !bestLoaded },
          { label: "Target", value: TARGET },
        ]}
      />

      <Box
        onClick={won ? reset : flip}
        role="button"
        tabIndex={-1}
        aria-label="Flip the coin"
        sx={{
          width: 132,
          height: 132,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: flipping ? "default" : "pointer",
          userSelect: "none",
          fontSize: "3rem",
          fontWeight: 800,
          color: "#0f1120",
          background:
            face === "H"
              ? "linear-gradient(145deg,#ffd76a,#e0a020)"
              : "linear-gradient(145deg,#c9ccd8,#8b8fa3)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          transition: "transform 120ms",
          animation: flipping ? "coinspin 450ms linear" : "none",
          "@keyframes coinspin": {
            "0%": { transform: "rotateY(0deg) scale(1)" },
            "50%": { transform: "rotateY(540deg) scale(1.08)" },
            "100%": { transform: "rotateY(1080deg) scale(1)" },
          },
          "&:active": { transform: flipping ? "none" : "scale(0.96)" },
        }}
      >
        {flipping ? "" : face === "H" ? "H" : "T"}
      </Box>

      <Stack direction="row" spacing={0.5} sx={{ minHeight: 22 }}>
        {history.map((s, i) => (
          <Box
            key={i}
            sx={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              fontSize: "0.6rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0f1120",
              bgcolor: s === "H" ? "#ffd76a" : "#8b8fa3",
            }}
          >
            {s}
          </Box>
        ))}
      </Stack>

      <Box sx={{ textAlign: "center", minHeight: 72 }}>
        {won ? (
          <Stack spacing={1.5} alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 700, color: "#ffd76a" }}>
              🎉 Ten in a row!
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Odds of that: 1 in 1,024
            </Typography>
            <Button variant="contained" onClick={reset}>
              Play again
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5} alignItems="center">
            <Typography
              variant="body2"
              color={result === "lose" ? "#ff5c8a" : "text.secondary"}
              sx={{ minHeight: 20 }}
            >
              {flipping
                ? "Flipping…"
                : result === "lose"
                  ? "Tails. Streak reset."
                  : streak > 0
                    ? `${streak} heads in a row — keep going.`
                    : "Flip to begin."}
            </Typography>
            <Button variant="contained" onClick={flip} disabled={flipping}>
              Flip
            </Button>
          </Stack>
        )}
      </Box>
    </>
  );
}
