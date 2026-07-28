"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

const SIZE = 220;
const RADIUS = 92;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A countdown as a draining ring, with the seconds left in the middle.
 *
 * Shared rather than game-local: anything with a phase timer wants this, and
 * it takes a plain remaining/total pair so it doesn't care where the clock
 * comes from.
 */
export default function CountdownRing({
  remainingMs,
  totalMs,
  label,
  caption,
  pulse = true,
}: {
  remainingMs: number;
  totalMs: number;
  /** Overrides the big number in the centre. */
  label?: string;
  caption?: string;
  /** Expanding halo rings. Suppressed automatically under reduced motion. */
  pulse?: boolean;
}) {
  const theme = useTheme();
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <Box
      sx={{
        position: "relative",
        width: SIZE,
        height: SIZE,
        display: "grid",
        placeItems: "center",
        "@media (prefers-reduced-motion: reduce)": {
          "& .pulse-ring": { display: "none" },
        },
      }}
    >
      {pulse
        ? [0, 1, 2].map((i) => (
            <Box
              key={i}
              className="pulse-ring"
              sx={{
                position: "absolute",
                inset: 24,
                borderRadius: "50%",
                border: `1px solid ${theme.palette.primary.main}`,
                opacity: 0,
                animation: "pitch-halo 2.4s ease-out infinite",
                animationDelay: `${i * 0.8}s`,
                "@keyframes pitch-halo": {
                  "0%": { transform: "scale(0.72)", opacity: 0.55 },
                  "100%": { transform: "scale(1.35)", opacity: 0 },
                },
              }}
            />
          ))
        : null}

      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="countdown-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={theme.palette.primary.main} />
            <stop offset="100%" stopColor="#39d8ff" />
          </linearGradient>
          <filter id="countdown-ring-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={theme.palette.divider}
          strokeWidth={5}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="url(#countdown-ring-grad)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          filter="url(#countdown-ring-glow)"
        />
      </svg>

      <Box sx={{ textAlign: "center", zIndex: 1 }}>
        <Typography
          sx={{
            fontSize: label ? "2rem" : "3.6rem",
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label ?? seconds}
        </Typography>
        {caption ? (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontSize: "0.65rem",
            }}
          >
            {caption}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
