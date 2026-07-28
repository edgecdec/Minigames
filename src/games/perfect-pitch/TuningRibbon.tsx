"use client";

import { useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import {
  OCTAVE_CENTS,
  PAD_CENTS,
  RANGE_CENTS,
  clampToPlayable,
} from "./logic";

/**
 * How much of the range is on screen at once — one octave. Never the whole
 * thing: seeing both ends would hand the player a reference frame to anchor
 * on, and a third of the range is already generous.
 */
const BASE_SPAN_CENTS = 1200;
const TICK_STEP = 25;
const CANVAS_HEIGHT = 280;
const REVEAL_MS = 1100;

/** Pointer acceleration ceiling: a slow drag is precise, a flick travels. */
const MAX_DRAG_BOOST = 3.5;
const BOOST_SPEED_PX_PER_MS = 1.6;

/**
 * Dragging away from the line you started on scales movement down, the way a
 * scrubbing control does. On a phone there are no arrow keys and a 340px-wide
 * ribbon is about five cents per pixel, so this is the only way to land a
 * precise answer with a thumb.
 */
const FINE_FALLOFF_PX = 50;
const MIN_FINE_FACTOR = 0.05;

const TRACE_SECONDS = 0.012;

export interface RevealMarks {
  guessCents: number;
  targetCents: number;
}

/**
 * The pitch control: an endless strip of tick marks sliding under a fixed
 * crosshair, with a live oscilloscope of whatever is currently sounding.
 *
 * Three things it deliberately does NOT do:
 *  - show a number, ever, before the answer is locked in
 *  - show either end of the range, so there is no landmark to count from
 *  - colour by absolute pitch — the hue cycles once per octave and then
 *    repeats, which looks alive without leaking where you are
 */
export default function TuningRibbon({
  startCents,
  roundKey,
  interactive,
  reveal = null,
  onChange,
  onLock,
  readWaveform,
  sampleRate = 48000,
}: {
  startCents: number;
  /** Bump to reset the ribbon for a new round. */
  roundKey: number;
  interactive: boolean;
  reveal?: RevealMarks | null;
  /** Fired on every movement. Wire straight to the synth — not to state. */
  onChange?: (cents: number) => void;
  onLock?: () => void;
  readWaveform?: () => Float32Array | null;
  sampleRate?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const centsRef = useRef(startCents);
  const viewRef = useRef({ cents: startCents, span: BASE_SPAN_CENTS });
  const sizeRef = useRef({ w: 640, h: CANVAS_HEIGHT, dpr: 1 });
  const dragRef = useRef<{
    x: number;
    /** Where the drag started vertically — the anchor for fine scrubbing. */
    y0: number;
    t: number;
    id: number;
  } | null>(null);
  const fineRef = useRef(1);
  const revealAnimRef = useRef<{
    t0: number;
    fromCents: number;
    fromSpan: number;
    toCents: number;
    toSpan: number;
  } | null>(null);

  // Held in refs so a changing callback identity never restarts the draw loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  const readWaveformRef = useRef(readWaveform);
  readWaveformRef.current = readWaveform;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  const move = useCallback((deltaCents: number) => {
    if (!interactiveRef.current) return;
    const next = clampToPlayable(centsRef.current + deltaCents);
    if (next === centsRef.current) return;
    centsRef.current = next;
    viewRef.current.cents = next;
    onChangeRef.current?.(next);
  }, []);

  // --- reset for a new round ------------------------------------------------
  useEffect(() => {
    centsRef.current = startCents;
    viewRef.current = { cents: startCents, span: BASE_SPAN_CENTS };
    revealAnimRef.current = null;
  }, [roundKey, startCents]);

  // --- reveal: scroll to the answer, zooming in if the miss was small -------
  useEffect(() => {
    if (!reveal) {
      revealAnimRef.current = null;
      return;
    }
    const error = Math.abs(reveal.targetCents - reveal.guessCents);
    revealAnimRef.current = {
      t0: performance.now(),
      fromCents: viewRef.current.cents,
      fromSpan: viewRef.current.span,
      // Centre the midpoint so both markers stay on screen.
      toCents: (reveal.targetCents + reveal.guessCents) / 2,
      toSpan: Math.min(3200, Math.max(140, error * 3.2)),
    };
  }, [reveal]);

  // --- sizing ---------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const apply = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const w = wrap.clientWidth || 640;
      sizeRef.current = { w, h: CANVAS_HEIGHT, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(CANVAS_HEIGHT * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // --- wheel needs a non-passive listener to be able to preventDefault ------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (!interactiveRef.current) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      move(delta * 0.6);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [move]);

  // --- draw loop ------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const anim = revealAnimRef.current;
      const view = viewRef.current;
      if (anim) {
        const p = Math.min(1, (now - anim.t0) / REVEAL_MS);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        view.cents = anim.fromCents + (anim.toCents - anim.fromCents) * e;
        // Geometric interpolation, so zooming reads as constant-rate.
        view.span = anim.fromSpan * Math.pow(anim.toSpan / anim.fromSpan, e);
      }

      drawRibbon(ctx, {
        w,
        h,
        now,
        viewCents: view.cents,
        span: view.span,
        interactive: interactiveRef.current,
        fine: fineRef.current,
        reveal: revealRef.current,
        readWaveform: readWaveformRef.current,
        sampleRate,
      });
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [sampleRate]);

  // --- pointer --------------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointer; the drag still works without it.
    }
    dragRef.current = {
      x: e.clientX,
      y0: e.clientY,
      t: e.timeStamp,
      id: e.pointerId,
    };
    fineRef.current = 1;
    wrapRef.current?.focus();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;

    const dx = e.clientX - drag.x;
    const dt = Math.max(1, e.timeStamp - drag.t);
    dragRef.current = { ...drag, x: e.clientX, t: e.timeStamp };

    const speed = Math.abs(dx) / dt;
    const boost = Math.min(
      MAX_DRAG_BOOST,
      1 + (speed / BOOST_SPEED_PX_PER_MS) * (MAX_DRAG_BOOST - 1),
    );

    const fine = Math.max(
      MIN_FINE_FACTOR,
      1 / (1 + Math.abs(e.clientY - drag.y0) / FINE_FALLOFF_PX),
    );
    fineRef.current = fine;

    const centsPerPx = viewRef.current.span / Math.max(1, sizeRef.current.w);

    // The strip travels with the finger, so dragging left brings higher
    // pitches under the crosshair.
    move(-dx * centsPerPx * boost * fine);
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === e.pointerId) {
      dragRef.current = null;
      fineRef.current = 1;
    }
  };

  // --- keyboard -------------------------------------------------------------
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;

    const fine = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        move(fine);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        move(-fine);
        break;
      case "PageUp":
        e.preventDefault();
        move(100);
        break;
      case "PageDown":
        e.preventDefault();
        move(-100);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        onLockRef.current?.();
        break;
    }
  };

  return (
    <Box
      ref={wrapRef}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={handleKeyDown}
      aria-label="Pitch ribbon. Drag to change the tone, arrow keys to fine-tune, Enter to lock in."
      sx={{
        width: "100%",
        borderRadius: 3,
        overflow: "hidden",
        position: "relative",
        outline: "none",
        border: "1px solid",
        borderColor: interactive ? "primary.main" : "divider",
        boxShadow: interactive ? "0 0 0 3px rgba(124,92,255,0.14)" : "none",
        transition: "border-color 220ms ease, box-shadow 220ms ease",
        cursor: interactive ? "ew-resize" : "default",
        "&:focus-visible": { borderColor: "secondary.main" },
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ display: "block", touchAction: "none" }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Canvas drawing. Raw hex/hsl here is deliberate — MUI tokens can't reach
// inside a 2D context.
// ---------------------------------------------------------------------------

interface DrawArgs {
  w: number;
  h: number;
  now: number;
  viewCents: number;
  span: number;
  interactive: boolean;
  /** Current scrub sensitivity, 1 = normal. */
  fine: number;
  reveal: RevealMarks | null;
  readWaveform?: () => Float32Array | null;
  sampleRate: number;
}

/** Hue completes one full turn per octave and then repeats — pretty, but it
 *  carries no information about absolute pitch. */
function hueAt(cents: number): number {
  const within = ((cents % OCTAVE_CENTS) + OCTAVE_CENTS) % OCTAVE_CENTS;
  return (within / OCTAVE_CENTS) * 360;
}

/** 1 inside the playable range, easing to 0 across the padding either side. */
function rangeFade(cents: number): number {
  if (cents >= 0 && cents <= RANGE_CENTS) return 1;
  const past = cents < 0 ? -cents : cents - RANGE_CENTS;
  return Math.max(0, 1 - past / PAD_CENTS);
}

function drawRibbon(ctx: CanvasRenderingContext2D, a: DrawArgs) {
  const { w, h, viewCents, span } = a;
  const centsPerPx = span / w;
  const xAt = (cents: number) => (cents - viewCents) / centsPerPx + w / 2;

  const midY = h / 2;
  const scopeHalf = 52;
  const topEdge = 16;
  const bottomEdge = h - 16;

  ctx.clearRect(0, 0, w, h);

  // Backdrop -----------------------------------------------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c0e1c");
  bg.addColorStop(0.5, "#14172c");
  bg.addColorStop(1, "#0c0e1c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const centreHue = hueAt(viewCents);
  const glow = ctx.createRadialGradient(w / 2, midY, 0, w / 2, midY, w * 0.5);
  glow.addColorStop(0, `hsla(${centreHue}, 95%, 62%, ${a.interactive ? 0.2 : 0.09})`);
  glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Ticks --------------------------------------------------------------------
  const first = Math.floor((viewCents - span / 2) / TICK_STEP) * TICK_STEP;
  const last = viewCents + span / 2 + TICK_STEP;

  for (let c = first; c <= last; c += TICK_STEP) {
    const x = xAt(c);
    if (x < -30 || x > w + 30) continue;

    // Dissolve at the canvas edges as well as at the range limits, so the
    // strip always looks like it continues past what you can see.
    const edge = Math.min(1, Math.min(x, w - x) / 110);
    const alpha = rangeFade(c) * Math.max(0, edge);
    if (alpha <= 0.01) continue;

    const isOctave = Math.abs(c % OCTAVE_CENTS) < 0.001;
    const isSemitone = Math.abs(c % 100) < 0.001;
    const length = isOctave ? 30 : isSemitone ? 15 : 7;
    const weight = isOctave ? 0.95 : isSemitone ? 0.5 : 0.26;
    const hue = hueAt(c);

    ctx.strokeStyle = `hsla(${hue}, 78%, 74%, ${alpha * weight})`;
    ctx.lineWidth = isOctave ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, topEdge);
    ctx.lineTo(x, topEdge + length);
    ctx.moveTo(x, bottomEdge);
    ctx.lineTo(x, bottomEdge - length);
    ctx.stroke();

    if (isOctave) {
      ctx.strokeStyle = `hsla(${hue}, 78%, 70%, ${alpha * 0.12})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, topEdge);
      ctx.lineTo(x, bottomEdge);
      ctx.stroke();
    }
  }

  // Oscilloscope -------------------------------------------------------------
  drawScope(ctx, a, midY, scopeHalf, centreHue);

  // Crosshair ----------------------------------------------------------------
  if (!a.reveal) {
    const cx = w / 2;
    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = `hsla(${centreHue}, 95%, 65%, 0.9)`;
    ctx.strokeStyle = a.interactive
      ? "rgba(255,255,255,0.92)"
      : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, topEdge - 6);
    ctx.lineTo(cx, midY - scopeHalf - 6);
    ctx.moveTo(cx, midY + scopeHalf + 6);
    ctx.lineTo(cx, bottomEdge + 6);
    ctx.stroke();

    ctx.fillStyle = a.interactive
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.4)";
    triangle(ctx, cx, topEdge - 8, 7, 1);
    triangle(ctx, cx, bottomEdge + 8, 7, -1);
    ctx.restore();
  }

  // Fine-scrub readout -------------------------------------------------------
  if (a.interactive && !a.reveal && a.fine < 0.8) {
    ctx.save();
    ctx.font = "700 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = `hsla(${centreHue}, 90%, 78%, 0.9)`;
    ctx.fillText(
      `FINE ×${a.fine.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`,
      w / 2,
      midY + scopeHalf + 26,
    );
    ctx.restore();
  }

  // Reveal markers -----------------------------------------------------------
  if (a.reveal) {
    drawMarker(ctx, xAt(a.reveal.guessCents), h, "#ffb547", "YOU", w);
    drawMarker(ctx, xAt(a.reveal.targetCents), h, "#3ddc97", "TARGET", w);
  }

  // Vignette so the strip fades out rather than being cut off ----------------
  const vignette = ctx.createLinearGradient(0, 0, w, 0);
  vignette.addColorStop(0, "rgba(12,14,28,0.95)");
  vignette.addColorStop(0.12, "rgba(12,14,28,0)");
  vignette.addColorStop(0.88, "rgba(12,14,28,0)");
  vignette.addColorStop(1, "rgba(12,14,28,0.95)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function triangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  dir: 1 | -1,
) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * dir);
  ctx.lineTo(x - size * 0.8, y);
  ctx.lineTo(x + size * 0.8, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * A fixed time window of the live output, so a higher pitch visibly packs more
 * cycles into the same space. Amplitude is normalised — the loudness curve
 * already flattens perceived volume and the trace shouldn't undo that.
 */
function drawScope(
  ctx: CanvasRenderingContext2D,
  a: DrawArgs,
  midY: number,
  half: number,
  hue: number,
) {
  const { w } = a;
  const wave = a.readWaveform?.() ?? null;

  let peak = 0;
  if (wave) {
    for (let i = 0; i < wave.length; i++) {
      const v = Math.abs(wave[i]);
      if (v > peak) peak = v;
    }
  }

  ctx.save();
  ctx.lineWidth = 2.25;
  ctx.lineJoin = "round";
  ctx.shadowBlur = 16;
  ctx.shadowColor = `hsla(${hue}, 95%, 62%, 0.85)`;
  ctx.strokeStyle = `hsla(${hue}, 92%, 72%, 0.95)`;
  ctx.beginPath();

  if (!wave || peak < 1e-4) {
    // Silence: a resting line with the faintest drift, so the panel never
    // looks broken.
    for (let x = 0; x <= w; x += 4) {
      const y = midY + Math.sin(x * 0.02 + a.now * 0.0012) * 1.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.3;
  } else {
    const windowSize = Math.min(
      wave.length - 1,
      Math.max(64, Math.round(a.sampleRate * TRACE_SECONDS)),
    );

    // Trigger on a rising zero crossing so the trace doesn't slide around.
    let start = 0;
    for (let i = 1; i < wave.length - windowSize; i++) {
      if (wave[i - 1] <= 0 && wave[i] > 0) {
        start = i;
        break;
      }
    }

    for (let px = 0; px <= w; px++) {
      const idx = start + Math.round((px / w) * windowSize);
      const v = wave[Math.min(wave.length - 1, idx)] / peak;
      const y = midY - v * half * 0.86;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  colour: string,
  label: string,
  w: number,
) {
  const offScreen = x < 12 || x > w - 12;
  const clamped = Math.min(w - 12, Math.max(12, x));

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 12;
  ctx.shadowColor = colour;

  ctx.setLineDash(offScreen ? [5, 5] : []);
  ctx.beginPath();
  ctx.moveTo(clamped, 10);
  ctx.lineTo(clamped, h - 10);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "700 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = x > w - 70 ? "right" : "left";
  const textX = x > w - 70 ? clamped - 7 : clamped + 7;
  // An off-screen marker still says which way to look.
  const text = offScreen ? `${x < 12 ? "◀ " : ""}${label}${x > 12 ? " ▶" : ""}` : label;
  ctx.fillText(text, textX, 20);
  ctx.restore();
}
