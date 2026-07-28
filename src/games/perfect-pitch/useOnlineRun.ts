"use client";

import { useCallback, useRef, useState } from "react";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { type Guess, type Waveform, hzAtCents } from "./logic";
import { type MaskedRound, roundKey, unmaskCents } from "./mask";
import { type TrajectoryFeatures, type TrajectoryPoint } from "./trajectory";
import { SLUG } from "./shared";

/**
 * A run the server owns.
 *
 * The client never computes a score here. It asks for a tone, sends back where
 * it thinks the tone was, and is told how it did. Round N+1 only arrives in
 * the reply to round N, so the five rounds are a chain rather than a list.
 *
 * Every failure path lands in the same place: `available` goes false and the
 * game drops to offline play. A leaderboard being down should cost you the
 * leaderboard, not the game.
 */

const RUN_ID_KEY = `minigames:${SLUG}:onlineRunId`;

/**
 * A round as the client holds it: still masked.
 *
 * Deliberately NOT unmasked on arrival. The decode happens at the moment the
 * oscillator is started and the result is never assigned to anything that
 * outlives that call, so there is no `targetCents` sitting in component state
 * for a breakpoint to land on.
 */
export interface ServedRound {
  index: number;
  startCents: number;
  /** Opaque; feed to `revealTone` when it's time to make a sound. */
  sealed: { s: string; m: number; i: number; runId: string };
}

export interface SubmitOutcome {
  accepted: boolean;
  verified: boolean;
  best?: number;
  name?: string;
  flags?: string[];
  error?: string;
}

export interface GuessSubmission {
  /** Which round is being answered; the server refuses a mismatch. */
  roundIndex: number;
  guessCents: number;
  listenMs: number;
  huntMs: number;
  pointerType: string;
  trajectory: TrajectoryPoint[];
  features: TrajectoryFeatures;
  startCents: number;
  waveform: Waveform;
}

/**
 * Turns a sealed round into a frequency, at the last possible moment.
 *
 * Call this inline as the argument to the synth — never store what it returns.
 */
export function revealTone(sealed: ServedRound["sealed"]): number {
  return hzAtCents(
    unmaskCents(sealed.m, roundKey(sealed.runId, sealed.s, sealed.i)),
  );
}

function seal(runId: string, raw: MaskedRound): ServedRound {
  return {
    index: raw.i,
    startCents: raw.sc,
    sealed: { s: raw.s, m: raw.m, i: raw.i, runId },
  };
}

async function call(payload: Record<string, unknown>) {
  const res = await fetch(`/api/${SLUG}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function useOnlineRun() {
  const [round, setRound] = useState<ServedRound | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null until we've had a reason to believe either way. */
  const [available, setAvailable] = useState<boolean | null>(null);

  const [storedRunId, setStoredRunId] = useLocalStorage<string | null>(
    RUN_ID_KEY,
    null,
  );
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = storedRunId;

  const fail = useCallback((message: string, offline: boolean) => {
    setError(message);
    if (offline) setAvailable(false);
  }, []);

  const start = useCallback(async (): Promise<ServedRound | null> => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await call({ action: "start" });
      if (!ok) {
        fail(
          typeof data.error === "string" ? data.error : "Could not start",
          data.offline === true,
        );
        return null;
      }
      setAvailable(true);
      const runId = data.runId as string;
      setStoredRunId(runId);
      setGuesses([]);
      const served = seal(runId, data.round as MaskedRound);
      setRound(served);
      return served;
    } catch {
      fail("Could not reach the server", true);
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail, setStoredRunId]);

  /**
   * Picks an interrupted run back up. The server re-rolls the pending target
   * if its tone already went out, so reloading is never a second listen.
   */
  const resume = useCallback(async (): Promise<ServedRound | null> => {
    const runId = runIdRef.current;
    if (!runId) return null;

    setBusy(true);
    try {
      const { ok, data } = await call({ action: "resume", runId });
      if (!ok) {
        // A stale or finished run isn't an error worth showing.
        setStoredRunId(null);
        if (data.offline === true) setAvailable(false);
        return null;
      }
      setAvailable(true);
      const served = seal(runId, data.round as MaskedRound);
      setRound(served);
      return served;
    } catch {
      fail("Could not reach the server", true);
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail, setStoredRunId]);

  const submitGuess = useCallback(
    async (input: GuessSubmission): Promise<Guess | null> => {
      const runId = runIdRef.current;
      if (!runId) return null;

      setBusy(true);
      try {
        const { ok, data } = await call({
          action: "guess",
          runId,
          roundIndex: input.roundIndex,
          guessCents: input.guessCents,
          listenMs: input.listenMs,
          huntMs: input.huntMs,
          pointerType: input.pointerType,
          trajectory: input.trajectory,
        });

        if (!ok) {
          fail(
            typeof data.error === "string" ? data.error : "Guess rejected",
            data.offline === true,
          );
          return null;
        }

        // The server owns the numbers; the client contributes only the
        // metadata it alone knows.
        const r = data.result as {
          targetHz: number;
          guessHz: number;
          cents: number;
          score: number;
        };
        const guess: Guess = {
          targetHz: r.targetHz,
          guessHz: r.guessHz,
          cents: r.cents,
          score: r.score,
          listenMs: input.listenMs,
          huntMs: input.huntMs,
          waveform: input.waveform,
          at: Date.now(),
          startCents: input.startCents,
          traj: input.features,
        };

        setGuesses((prev) => [...prev, guess]);
        const next = data.next as MaskedRound | null;
        setRound(next ? seal(runId, next) : null);
        setError(null);
        return guess;
      } catch {
        fail("Could not reach the server", true);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const submitToBoard = useCallback(
    async (name: string): Promise<SubmitOutcome | null> => {
      const runId = runIdRef.current;
      if (!runId) return null;

      setBusy(true);
      try {
        const { ok, data } = await call({ action: "submit", runId, name });
        if (!ok) {
          fail(
            typeof data.error === "string" ? data.error : "Could not submit",
            data.offline === true,
          );
          return null;
        }
        setStoredRunId(null);
        return data as SubmitOutcome;
      } catch {
        fail("Could not reach the server", true);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail, setStoredRunId],
  );

  const reset = useCallback(() => {
    setRound(null);
    setGuesses([]);
    setError(null);
    setStoredRunId(null);
  }, [setStoredRunId]);

  return {
    available,
    round,
    guesses,
    busy,
    error,
    runId: storedRunId,
    start,
    resume,
    submitGuess,
    submitToBoard,
    reset,
  };
}
