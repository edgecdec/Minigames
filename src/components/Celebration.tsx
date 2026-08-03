"use client";

import { useEffect, useRef } from "react";
import { fireWinConfetti, firePopConfetti, prefersReducedMotion } from "@/lib/confetti";

/**
 * Fires confetti once per distinct `key` while `active` is true.
 *
 * Shared so a game only has to say WHEN to celebrate. The `key` is what makes it
 * fire once rather than on every re-render: a multiplayer room re-broadcasts its
 * state constantly, so an effect keyed only on `active` would re-fire forever.
 * Pass something that changes per celebration — a round number, a match id.
 */
export default function Celebration({
  active,
  celebrationKey,
  variant = "win",
  colors,
}: {
  active: boolean;
  celebrationKey: string | number;
  variant?: "win" | "pop";
  colors?: string[];
}) {
  const firedFor = useRef<string | number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (firedFor.current === celebrationKey) return;
    firedFor.current = celebrationKey;

    // Honour the OS setting: a full-screen particle storm is exactly what
    // reduced-motion is asking us not to do.
    if (prefersReducedMotion()) return;

    void (variant === "pop" ? firePopConfetti(colors) : fireWinConfetti(colors));
  }, [active, celebrationKey, variant, colors]);

  // Purely a side effect — nothing to render, and nothing that could ever
  // intercept a click on the buttons underneath.
  return null;
}
