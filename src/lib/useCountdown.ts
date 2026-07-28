"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wall-clock countdown for timed games.
 *
 * Derives remaining time from a start timestamp rather than decrementing on a
 * tick, so a throttled background tab or a slow frame can't hand the player
 * extra time. Shared because any timed game needs exactly this.
 */
export function useCountdown(onExpire: () => void) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [running, setRunning] = useState(false);
  const deadline = useRef<number>(0);
  const expired = useRef(false);
  // Held in a ref so a changing callback identity doesn't restart the timer.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const start = useCallback((durationMs: number) => {
    deadline.current = Date.now() + durationMs;
    expired.current = false;
    setRemainingMs(durationMs);
    setRunning(true);
  }, []);

  const stop = useCallback(() => setRunning(false), []);

  useEffect(() => {
    if (!running) return;
    let frame: number;

    const tick = () => {
      const left = deadline.current - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        setRunning(false);
        if (!expired.current) {
          expired.current = true;
          onExpireRef.current();
        }
        return;
      }
      setRemainingMs(left);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return { remainingMs, running, start, stop };
}
