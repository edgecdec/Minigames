"use client";

import { useEffect, useRef } from "react";
import { ToneSynth } from "./toneSynth";

/**
 * Owns one ToneSynth for the lifetime of a component and tears it down on
 * unmount, so navigating away can never leave a tone ringing.
 *
 * Returns the instance directly rather than state — audio is imperative, and
 * routing every frequency change through React would re-render the tree on
 * every pointer move.
 */
export function useToneSynth(referenceHz: number): ToneSynth {
  const ref = useRef<ToneSynth | null>(null);

  // Constructing is pure — nothing touches `window` until resume() — so this
  // is safe during an SSR render pass.
  if (ref.current === null) {
    ref.current = new ToneSynth({ referenceHz });
  }

  useEffect(() => {
    const synth = ref.current;
    return () => synth?.dispose();
  }, []);

  return ref.current;
}
