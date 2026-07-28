"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ScoreBar from "@/components/ScoreBar";
import { useBestScore, useLocalStorage } from "@/lib/useLocalStorage";
import { createGame, score, submit, type LetsGetHighState } from "./logic";

const TAUNTS = ["Your turn, number wizard!", "I’ll raise you!", "Beat that, big brain!", "The number must go up!", "No ceiling. No fear."];

function Bob({ mood }: { mood: "idle" | "thinking" | "happy" | "sad" }) {
  const face = mood === "sad" ? `  x_x\n /|\\\n / \\` : mood === "happy" ? `  ^_^\n /|\\\n / \\` : `  o_o\n /|\\\n / \\`;
  return (
    <Box className={`bob bob-${mood}`} role="img" aria-label="Lilian the pixel guide" sx={{ textAlign: "center", animation: mood === "sad" ? "none" : "bobFloat 1.6s ease-in-out infinite", "@keyframes bobFloat": { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } } }}>
      <Box component="pre" sx={{ m: 0, fontFamily: "monospace", fontWeight: 800, lineHeight: 1.05, fontSize: { xs: "1.15rem", sm: "1.4rem" } }}>
        {face}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>LILIAN{mood === "thinking" ? " •••" : ""}</Typography>
    </Box>
  );
}

function parseAnswer(raw: string): bigint | null {
  const clean = raw.trim();
  if (!/^\d+$/.test(clean) || /^0+$/.test(clean)) return null;
  try { return BigInt(clean); } catch { return null; }
}

function formatBigInt(value: bigint | string): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function numberFontSize(value: bigint): string {
  const digits = value.toString().length;
  if (digits >= 90) return "0.48rem";
  if (digits >= 60) return "0.62rem";
  if (digits >= 40) return "0.82rem";
  if (digits >= 25) return "1.05rem";
  if (digits >= 15) return "1.45rem";
  return "clamp(2rem, 10vw, 3.5rem)";
}

export default function LetsGetHighGame() {
  const [state, setState] = useState<LetsGetHighState>(() => createGame());
  const [answer, setAnswer] = useState("");
  const [best, submitBest, bestLoaded] = useBestScore("lets-get-high");
  const [bestNumber, setBestNumber, bestNumberLoaded] = useLocalStorage("minigames:best-number:lets-get-high", "0");
  const inputRef = useRef<HTMLInputElement>(null);
  const [taunt, setTaunt] = useState(TAUNTS[0]);

  useEffect(() => { inputRef.current?.focus(); }, [state.status]);

  const onSubmit = () => {
    const parsed = parseAnswer(answer);
    if (parsed === null) return;
    const next = submit(state, parsed);
    setState(next);
    setAnswer("");
    if (next.status === "playing") {
      setTaunt(TAUNTS[Math.floor(Math.random() * TAUNTS.length)]);
      if (parsed > BigInt(bestNumber || "0")) setBestNumber(parsed.toString());
      submitBest(next.rounds);
    }
  };

  const reset = () => { setState(createGame()); setAnswer(""); setTaunt(TAUNTS[0]); };
  const share = async () => {
    const text = `I got ${formatBigInt(bestNumber)} in Let's Get High! Can you go higher?`;
    if (navigator.share) await navigator.share({ title: "Let's Get High", text });
    else await navigator.clipboard?.writeText(text);
  };
  const lost = state.status === "lost";
  const bobMood = lost ? "sad" : state.rounds > 0 ? "happy" : state.status === "playing" ? "thinking" : "idle";

  return <>
    <ScoreBar stats={[{ label: "Raises", value: state.rounds }, { label: "Best raises", value: best, muted: !bestLoaded }, { label: "Biggest", value: bestNumberLoaded ? formatBigInt(bestNumber) : "…", muted: !bestNumberLoaded }]} />
    <Stack spacing={2.5} alignItems="center" sx={{ width: "100%", py: 1 }}>
      <Bob mood={bobMood} />
      <Typography variant="body1" sx={{ textAlign: "center", fontWeight: 700 }}>{lost ? "Oh no! That number was not higher." : state.status === "waiting" ? "I’ll go first? Nope—YOU go first! Type any positive whole number." : state.milestone || taunt}</Typography>
      {state.status === "playing" && <Typography className="huge-number" sx={{ width: "100%", px: { xs: 1, sm: 2 }, textAlign: "center", fontWeight: 900, lineHeight: 1.15, color: "primary.main", fontSize: numberFontSize(state.current), overflowWrap: "anywhere", wordBreak: "break-word", letterSpacing: "0.02em" }}>{formatBigInt(state.current)}</Typography>}
      {lost && <Typography color="text.secondary" sx={{ textAlign: "center", overflowWrap: "anywhere", px: 2 }}>You entered {state.lastAnswer ? formatBigInt(state.lastAnswer) : "—"}. Lilian’s number was {formatBigInt(state.current)}.</Typography>}
      {lost ? <Stack direction="row" spacing={1}><Button variant="contained" onClick={reset}>Try again</Button><Button variant="outlined" onClick={share}>Share my high score</Button></Stack> : <Stack direction="row" spacing={1} sx={{ width: "100%", maxWidth: 520 }}><TextField inputRef={inputRef} fullWidth value={answer} onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }} placeholder="Type any positive whole number" autoComplete="off" inputProps={{ inputMode: "numeric", "aria-label": "Your number" }} /><Button variant="contained" onClick={onSubmit} disabled={parseAnswer(answer) === null}>Go!</Button></Stack>}
      {state.status === "waiting" && <Typography variant="caption" color="text.secondary">No decimals. No negatives. No ceiling.</Typography>}
    </Stack>
  </>;
}
