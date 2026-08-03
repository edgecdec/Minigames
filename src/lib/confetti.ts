"use client";

/**
 * Shared confetti helpers.
 *
 * Follows the pattern the sibling projects settled on (TopTenGame,
 * SuperConnections, PhotoGuessr): a dynamic import so canvas-confetti never
 * lands in the main bundle, and every call wrapped so a load failure can't
 * break the game underneath. This is decoration — it must never throw into a
 * round.
 */

/** Site palette, so a celebration looks like it belongs here. */
const HOUSE = ["#7c5cff", "#a692ff", "#39d8ff", "#3ddc97", "#ffd76a", "#ff5c8a"];

type ConfettiFn = (opts: Record<string, unknown>) => void;

async function load(): Promise<ConfettiFn | null> {
  try {
    const mod = await import("canvas-confetti");
    return mod.default as unknown as ConfettiFn;
  } catch {
    return null;
  }
}

/**
 * A win burst: opening cannons from both lower corners, a centre fountain, then
 * drifting streamers so the screen keeps moving rather than emptying out after
 * half a second.
 */
export async function fireWinConfetti(colors: string[] = HOUSE): Promise<void> {
  const confetti = await load();
  if (!confetti) return;

  try {
    const cannon = (x: number, angle: number) =>
      confetti({
        particleCount: 80,
        spread: 70,
        angle,
        startVelocity: 60,
        origin: { x, y: 0.75 },
        colors,
        scalar: 1.1,
      });
    cannon(0.15, 60);
    cannon(0.85, 120);

    confetti({
      particleCount: 140,
      spread: 105,
      startVelocity: 50,
      origin: { x: 0.5, y: 0.62 },
      colors,
      scalar: 1.15,
    });

    const end = Date.now() + 2400;
    const drift = setInterval(() => {
      if (Date.now() > end) {
        clearInterval(drift);
        return;
      }
      confetti({
        particleCount: 12,
        spread: 55,
        startVelocity: 20,
        gravity: 0.55,
        decay: 0.93,
        ticks: 300,
        // Random x along the top edge; each tick seeds a new streamer.
        origin: { x: Math.random(), y: -0.05 },
        colors,
        shapes: ["square"],
        scalar: 1.35,
      });
    }, 180);
  } catch {
    // Decoration only.
  }
}

/** A small, quick pop — for a good moment that isn't the end of the game. */
export async function firePopConfetti(colors: string[] = HOUSE): Promise<void> {
  const confetti = await load();
  if (!confetti) return;
  try {
    confetti({
      particleCount: 45,
      spread: 60,
      startVelocity: 35,
      origin: { y: 0.5 },
      colors,
      scalar: 0.95,
    });
  } catch {
    // Decoration only.
  }
}

/** True when the visitor has asked for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
