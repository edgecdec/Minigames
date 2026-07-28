"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

const POLL_MS = 15_000;
const RED = "#ff3b3b";
const RED_SOFT = "#ff7a7a";

/**
 * Red Guy's complete filmography. The joke is that "random" has exactly one
 * possible outcome, so the shuffle is played completely straight.
 */
const VIDEOS = [{ id: "AxPOmYFy90I", title: "i am quitting youtube" }];

/** Escalating deadpan captions for repeat presses. */
const SHUFFLE_QUIPS = [
  "Shuffling…",
  "Shuffling again…",
  "Reticulating splines…",
  "Consulting the algorithm…",
  "Statistically, this was likely.",
  "The odds were 1 in 1.",
  "Astonishing. The same one.",
  "You keep doing this.",
  "This is the whole catalogue.",
  "He did say he was quitting.",
];

interface Snapshot {
  subscribers: number | null;
  views: number | null;
  videos: number | null;
  stale?: boolean;
  channelUrl?: string;
}

/** One digit that slides when its value changes. */
function Digit({ char, flash }: { char: string; flash: boolean }) {
  if (!/\d/.test(char)) {
    return (
      <Box
        component="span"
        sx={{ fontSize: "inherit", fontWeight: 800, opacity: 0.35, px: 0.25 }}
      >
        {char}
      </Box>
    );
  }

  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        position: "relative",
        width: "0.62em",
        textAlign: "center",
        fontWeight: 900,
        fontVariantNumeric: "tabular-nums",
        // Re-keying the element on change restarts this animation.
        animation: flash ? "digitRoll 420ms cubic-bezier(.2,.8,.2,1)" : "none",
        "@keyframes digitRoll": {
          "0%": { transform: "translateY(-0.5em) scale(1.15)", opacity: 0, filter: "blur(3px)" },
          "60%": { opacity: 1, filter: "blur(0)" },
          "100%": { transform: "translateY(0) scale(1)", opacity: 1 },
        },
      }}
    >
      {char}
    </Box>
  );
}

export default function RedGuyGame() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Value actually painted — eased toward the real count so it climbs visibly.
  const [shown, setShown] = useState<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const [bursts, setBursts] = useState<{ id: number; x: number }[]>([]);

  const target = useRef<number | null>(null);
  const shownRef = useRef<number | null>(null);
  const prevReal = useRef<number | null>(null);
  const burstId = useRef(0);
  const reduceMotion = useRef(false);

  // Random-video bit
  const [picked, setPicked] = useState<(typeof VIDEOS)[number] | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [presses, setPresses] = useState(0);
  const shuffleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (shuffleTimer.current) clearTimeout(shuffleTimer.current);
    },
    [],
  );

  const shuffle = useCallback(() => {
    if (shuffling) return;
    setShuffling(true);
    setPresses((p) => p + 1);
    // A real (if pointless) draw — the list genuinely has one entry.
    const choice = VIDEOS[Math.floor(Math.random() * VIDEOS.length)];
    shuffleTimer.current = setTimeout(() => {
      setPicked(choice);
      setShuffling(false);
    }, 700);
  }, [shuffling]);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/redguy", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || typeof json.subscribers !== "number") {
        setError(json?.error ?? "Could not reach YouTube");
        return;
      }
      setData(json);
      setError(null);

      const next = json.subscribers as number;
      if (prevReal.current !== null && next !== prevReal.current) {
        setDelta(next - prevReal.current);
        setPulse((p) => p + 1);
        if (!reduceMotion.current) {
          const id = ++burstId.current;
          setBursts((b) => [...b.slice(-6), { id, x: Math.random() * 80 + 10 }]);
          window.setTimeout(
            () => setBursts((b) => b.filter((x) => x.id !== id)),
            1400,
          );
        }
      }
      prevReal.current = next;
      target.current = next;
      // First load lands instantly; later changes animate.
      if (shownRef.current === null) {
        shownRef.current = next;
        setShown(next);
      }
    } catch {
      setError("Could not reach YouTube");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Ease the displayed number toward the real one.
  useEffect(() => {
    let frame: number;
    const tick = () => {
      const t = target.current;
      const s = shownRef.current;
      if (t !== null && s !== null && t !== s) {
        const diff = t - s;
        // Always move at least one whole subscriber so it can't stall.
        const stepSize = Math.max(1, Math.floor(Math.abs(diff) / 12));
        const next = diff > 0 ? Math.min(t, s + stepSize) : Math.max(t, s - stepSize);
        shownRef.current = next;
        setShown(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const digits = shown === null ? [] : shown.toLocaleString("en-US").split("");

  return (
    <>
      {/* Ambient glow that throbs on every change */}
      <Box
        sx={{
          position: "relative",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 2,
        }}
      >
        <Box
          key={`glow-${pulse}`}
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 320,
            height: 320,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${RED}33 0%, transparent 68%)`,
            pointerEvents: "none",
            animation: "glowPulse 2.6s ease-in-out infinite",
            "@keyframes glowPulse": {
              "0%,100%": { opacity: 0.45, transform: "translate(-50%,-50%) scale(1)" },
              "50%": { opacity: 0.85, transform: "translate(-50%,-50%) scale(1.12)" },
            },
          }}
        />

        {/* Floating +1 bursts */}
        {bursts.map((b) => (
          <Box
            key={b.id}
            sx={{
              position: "absolute",
              left: `${b.x}%`,
              bottom: 60,
              color: RED_SOFT,
              fontWeight: 800,
              fontSize: "1.1rem",
              pointerEvents: "none",
              animation: "floatUp 1.4s ease-out forwards",
              "@keyframes floatUp": {
                "0%": { opacity: 0, transform: "translateY(0) scale(0.7)" },
                "20%": { opacity: 1, transform: "translateY(-14px) scale(1.1)" },
                "100%": { opacity: 0, transform: "translateY(-90px) scale(1)" },
              },
            }}
          >
            +1
          </Box>
        ))}

        <Typography
          variant="overline"
          sx={{ color: RED_SOFT, letterSpacing: "0.25em", fontSize: "0.7rem", zIndex: 1 }}
        >
          Red Guy
        </Typography>

        {/* The count */}
        <Box
          sx={{
            zIndex: 1,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            fontSize: { xs: "3rem", sm: "4.25rem" },
            lineHeight: 1.05,
            color: "#fff",
            textShadow: `0 0 26px ${RED}88, 0 0 60px ${RED}44`,
            minHeight: "1.2em",
          }}
        >
          {shown === null ? (
            <Box component="span" sx={{ fontSize: "0.5em", opacity: 0.5, fontWeight: 700 }}>
              {error ? "—" : "loading…"}
            </Box>
          ) : (
            digits.map((c, i) => (
              // Key includes the character so a changed digit remounts and replays.
              <Digit key={`${i}-${c}`} char={c} flash={!reduceMotion.current} />
            ))
          )}
        </Box>

        <Typography
          variant="body2"
          sx={{ color: "text.secondary", letterSpacing: "0.18em", textTransform: "uppercase", zIndex: 1, mt: 0.5 }}
        >
          subscribers
        </Typography>

        {/* Change since the previous poll */}
        <Box sx={{ minHeight: 28, mt: 1, zIndex: 1 }}>
          {delta !== null && delta !== 0 ? (
            <Typography
              key={`d-${pulse}`}
              sx={{
                color: delta > 0 ? "#7ce8a4" : RED,
                fontWeight: 700,
                fontSize: "0.95rem",
                animation: "popIn 500ms ease-out",
                "@keyframes popIn": {
                  "0%": { opacity: 0, transform: "scale(0.7)" },
                  "100%": { opacity: 1, transform: "scale(1)" },
                },
              }}
            >
              {delta > 0 ? "▲ +" : "▼ "}
              {Math.abs(delta).toLocaleString()} since last check
            </Typography>
          ) : null}
        </Box>
      </Box>

      {/* Secondary stats */}
      <Stack direction="row" spacing={1.5} sx={{ width: "100%", maxWidth: 420 }}>
        {[
          { label: "Views", value: data?.views },
          { label: "Videos", value: data?.videos },
        ].map((s) => (
          <Box
            key={s.label}
            sx={{
              flex: 1,
              px: 2,
              py: 1.25,
              borderRadius: 2,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: `${RED}22`,
              textAlign: "center",
            }}
          >
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "0.65rem" }}
            >
              {s.label}
            </Typography>
            <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {typeof s.value === "number" ? s.value.toLocaleString() : "—"}
            </Typography>
          </Box>
        ))}
      </Stack>

      {error ? (
        <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
          {error} — retrying automatically
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Live · updates every {POLL_MS / 1000}s
          {data?.stale ? " · showing last known value" : ""}
        </Typography>
      )}

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", justifyContent: "center" }} useFlexGap>
        <Button
          variant="outlined"
          href={data?.channelUrl ?? "https://www.youtube.com/@IAmRedGuy"}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            color: RED_SOFT,
            borderColor: `${RED}66`,
            "&:hover": { borderColor: RED, bgcolor: `${RED}11` },
          }}
        >
          Subscribe on YouTube
        </Button>

        <Button variant="contained" onClick={shuffle} disabled={shuffling}>
          {shuffling ? "🎲 Shuffling…" : "🎲 Random video"}
        </Button>
      </Stack>

      {/* Random-video result */}
      <Box sx={{ width: "100%", maxWidth: 420, minHeight: picked || shuffling ? 250 : 0 }}>
        {shuffling ? (
          <Box
            sx={{
              height: 236,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: `${RED}22`,
            }}
          >
            <Typography
              sx={{
                fontSize: "2.5rem",
                animation: "spin 700ms linear",
                "@keyframes spin": {
                  "0%": { transform: "rotate(0deg) scale(1)" },
                  "100%": { transform: "rotate(720deg) scale(1)" },
                },
              }}
            >
              🎲
            </Typography>
          </Box>
        ) : picked ? (
          <Stack spacing={1}>
            <Box
              sx={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: 2,
                overflow: "hidden",
                border: "1px solid",
                borderColor: `${RED}44`,
                animation: "dropIn 380ms cubic-bezier(.2,.8,.2,1)",
                "@keyframes dropIn": {
                  "0%": { opacity: 0, transform: "translateY(-12px) scale(0.97)" },
                  "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
                },
              }}
            >
              <Box
                component="iframe"
                src={`https://www.youtube-nocookie.com/embed/${picked.id}`}
                title={picked.title}
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </Box>
            <Typography variant="body2" sx={{ textAlign: "center", fontWeight: 700 }}>
              “{picked.title}”
            </Typography>
            <Typography
              variant="caption"
              sx={{ textAlign: "center", color: "text.secondary", fontStyle: "italic" }}
            >
              {SHUFFLE_QUIPS[Math.min(presses - 1, SHUFFLE_QUIPS.length - 1)]}
              {presses > 1 ? ` (${presses} rolls, ${presses} identical results)` : ""}
            </Typography>
          </Stack>
        ) : null}
      </Box>
    </>
  );
}
