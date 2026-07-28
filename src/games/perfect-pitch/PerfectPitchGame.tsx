"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import HeadphonesIcon from "@mui/icons-material/Headphones";
import LockIcon from "@mui/icons-material/Lock";
import TuneIcon from "@mui/icons-material/Tune";
import CountdownRing from "@/components/CountdownRing";
import GameSidebar, { type SidebarConfig } from "@/components/GameSidebar";
import ScoreBar from "@/components/ScoreBar";
import { useGlobalLeaderboard } from "@/lib/useGlobalLeaderboard";
import { useCountdown } from "@/lib/useCountdown";
import {
  useBestScore,
  useHistoryLog,
  useLocalStorage,
} from "@/lib/useLocalStorage";
import { useToneSynth } from "@/lib/useToneSynth";
import PitchStats from "./PitchStats";
import RoundReveal from "./RoundReveal";
import RunSummary from "./RunSummary";
import SoundSettings from "./SoundSettings";
import TuningRibbon from "./TuningRibbon";
import {
  type TrajectoryPoint,
  analyzeTrajectory,
  downsample,
} from "./trajectory";
import {
  type Guess,
  type RunRecord,
  type RunState,
  type Waveform,
  MIN_HZ,
  ROUNDS,
  createRun,
  hzAtCents,
  isRunComplete,
  rerollRound,
  scoreGuess,
  submitGuess,
  summarizeRun,
} from "./logic";

const SLUG = "perfect-pitch";

const SIDEBAR: SidebarConfig<Record<string, number>> = {
  global: { unit: "pts" },
};
const RUN_KEY = "minigames:run:perfect-pitch";

/** Phase one. Long enough to take the tone in, short enough that you can't
 *  sit there rehearsing it against a hum in the room. */
const LISTEN_MS = 4000;
const TONE_FADE_IN_MS = 220;
const TONE_FADE_OUT_MS = 350;
/** Silence between the target and your tone — this is what makes it memory. */
const GAP_MS = 200;
const REPLAY_MS = 1400;

/**
 * Raw movement samples kept per round. Generous — a long hunt on a 120Hz
 * pointer produces a lot of them — then thinned before anything is stored.
 */
const MAX_TRAJECTORY_SAMPLES = 800;
/** What the analysis actually runs on. Enough to keep the shape of a search. */
const TRAJECTORY_SAMPLES = 48;

type Phase = "idle" | "listen" | "gap" | "guess" | "reveal" | "summary";

interface SavedRun {
  run: RunState;
  /** True while a target has been heard but not yet answered. */
  armed: boolean;
}

export default function PerfectPitchGame() {
  const synth = useToneSynth(MIN_HZ);

  const [tab, setTab] = useState(0);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [ready, setReady] = useState(false);

  const [saved, setSaved, savedLoaded] = useLocalStorage<SavedRun | null>(
    RUN_KEY,
    null,
  );
  const [volume, setVolume] = useLocalStorage(`minigames:${SLUG}:volume`, 0.8);
  const [waveform, setWaveform] = useLocalStorage<Waveform>(
    `minigames:${SLUG}:waveform`,
    "sine",
  );

  const [guessLog, appendGuess, , clearGuesses] = useHistoryLog<Guess>(
    `${SLUG}:guesses`,
    2000,
  );
  const [runLog, appendRun, , clearRuns] = useHistoryLog<RunRecord>(
    `${SLUG}:runs`,
    400,
  );
  const [best, submitBest] = useBestScore(SLUG);
  const globalBoard = useGlobalLeaderboard(SLUG);

  const run = saved?.run ?? null;
  const roundIndex = run ? Math.min(run.guesses.length, ROUNDS - 1) : 0;

  const guessCentsRef = useRef(0);
  const listenStartRef = useRef(0);
  const listenMsRef = useRef(0);
  const huntStartRef = useRef(0);
  // How the ribbon actually moved this round. Recorded here rather than in
  // TuningRibbon because the ribbon already reports every movement through
  // onChange — there's nothing for it to do that isn't already happening.
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [newBest, setNewBest] = useState(false);

  // Phase transitions are driven from timers, from a visibility listener and
  // from an rAF countdown, all of which can race. The ref is the authority so
  // "are we still listening?" is answerable synchronously, before React has
  // re-rendered — every transition goes through setPhase to keep them in step.
  const phaseRef = useRef<Phase>("idle");
  const stopCountdownRef = useRef<() => void>(() => {});

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // --- resume, and never hand back a tone that was already heard ------------
  useEffect(() => {
    if (!savedLoaded || ready) return;

    if (saved?.run && !isRunComplete(saved.run)) {
      if (saved.armed) {
        // They heard a target and then reloaded. Re-roll rather than replay.
        setSaved({
          run: rerollRound(saved.run, saved.run.guesses.length),
          armed: false,
        });
      }
    } else if (saved?.run && isRunComplete(saved.run)) {
      setPhase("summary");
    }

    setReady(true);
  }, [savedLoaded, ready, saved, setSaved, setPhase]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    synth.setVolume(volume);
  }, [synth, volume]);

  useEffect(() => {
    synth.setWaveform(waveform);
  }, [synth, waveform]);

  // --- phase one ------------------------------------------------------------
  const finishListening = useCallback(() => {
    if (phaseRef.current !== "listen") return;
    stopCountdownRef.current();
    listenMsRef.current = performance.now() - listenStartRef.current;
    synth.stop(TONE_FADE_OUT_MS);
    setPhase("gap");

    clearTimers();
    after(TONE_FADE_OUT_MS + GAP_MS, () => {
      if (!run) return;
      const start = run.startCents[roundIndex];
      guessCentsRef.current = start;
      synth.start(hzAtCents(start), TONE_FADE_IN_MS);
      huntStartRef.current = performance.now();
      // Seed with the starting position so a round where nobody touches the
      // ribbon still has a first point to measure against.
      trajectoryRef.current = [{ t: 0, cents: start }];
      setPhase("guess");
    });
  }, [after, clearTimers, run, roundIndex, setPhase, synth]);

  const countdown = useCountdown(finishListening);
  stopCountdownRef.current = countdown.stop;

  const startCountdown = countdown.start;
  const beginRound = useCallback(async () => {
    if (!run) return;
    await synth.resume();
    synth.setWaveform(waveform);
    synth.setVolume(volume);

    setSaved({ run, armed: true });
    clearTimers();
    listenStartRef.current = performance.now();
    setPhase("listen");
    synth.start(hzAtCents(run.targetCents[roundIndex]), TONE_FADE_IN_MS);
    startCountdown(LISTEN_MS);
    // The ring runs on animation frames, which stop in a background tab. This
    // backstop is what actually guarantees the tone ends after four seconds.
    after(LISTEN_MS + 120, finishListening);
  }, [
    after,
    clearTimers,
    finishListening,
    roundIndex,
    run,
    setPhase,
    setSaved,
    startCountdown,
    synth,
    volume,
    waveform,
  ]);

  // Leaving mid-listen forfeits the rest of the listen. Otherwise hiding the
  // tab would hold the target open indefinitely, which is a free replay.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (phaseRef.current === "listen") finishListening();
        else if (phaseRef.current === "guess") synth.stop(150);
      } else if (phaseRef.current === "guess") {
        synth.start(hzAtCents(guessCentsRef.current), 140);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [finishListening, synth]);

  // --- phase two ------------------------------------------------------------
  const handleRibbonChange = useCallback(
    (cents: number) => {
      guessCentsRef.current = cents;
      synth.setFrequency(hzAtCents(cents));

      // Drop the oldest sample rather than the newest — the end of a hunt is
      // the interesting part, and an unbounded buffer is a slow leak.
      const trace = trajectoryRef.current;
      if (trace.length >= MAX_TRAJECTORY_SAMPLES) trace.shift();
      trace.push({ t: Math.round(performance.now() - huntStartRef.current), cents });
    },
    [synth],
  );

  const lockIn = useCallback(() => {
    if (!run || phaseRef.current !== "guess") return;

    const huntMs = Math.round(performance.now() - huntStartRef.current);
    const trace = downsample(trajectoryRef.current, TRAJECTORY_SAMPLES);

    const guess = scoreGuess(
      run.targetCents[roundIndex],
      guessCentsRef.current,
      {
        listenMs: Math.round(listenMsRef.current),
        huntMs,
        waveform,
        at: Date.now(),
        startCents: run.startCents[roundIndex],
        traj: analyzeTrajectory(trace, huntMs),
      },
    );

    synth.stop(200);
    const nextRun = submitGuess(run, guess);
    setSaved({ run: nextRun, armed: false });
    appendGuess(guess);

    // Recorded here rather than on the summary screen, so closing the tab on
    // the last reveal doesn't lose the run.
    if (isRunComplete(nextRun)) {
      const record = summarizeRun(nextRun, waveform);
      appendRun(record);
      setNewBest(submitBest(record.totalScore));
    }

    setPhase("reveal");
    clearTimers();
    // Let the ribbon finish travelling to the answer before the tone returns.
    after(900, () => synth.start(guess.targetHz, 120));
    after(900 + REPLAY_MS, () => synth.stop(260));
  }, [
    after,
    appendGuess,
    appendRun,
    clearTimers,
    roundIndex,
    run,
    setPhase,
    setSaved,
    submitBest,
    synth,
    waveform,
  ]);

  // --- phase three ----------------------------------------------------------
  const replay = useCallback(
    (hz: number) => {
      clearTimers();
      synth.start(hz, 100);
      after(REPLAY_MS, () => synth.stop(260));
    },
    [after, clearTimers, synth],
  );

  const goNext = useCallback(() => {
    clearTimers();
    synth.stop(160);
    setPhase(run && isRunComplete(run) ? "summary" : "idle");
  }, [clearTimers, run, setPhase, synth]);

  const startNewRun = useCallback(() => {
    clearTimers();
    synth.stop(160);
    setNewBest(false);
    setSaved({ run: createRun(), armed: false });
    setPhase("idle");
  }, [clearTimers, setPhase, setSaved, synth]);

  // A first-time player has no run yet; make one as soon as storage settles.
  useEffect(() => {
    if (ready && !run) setSaved({ run: createRun(), armed: false });
  }, [ready, run, setSaved]);

  const switchTab = (next: number) => {
    if (next === 1) {
      clearTimers();
      synth.stop(160);
      if (phase === "listen" || phase === "gap" || phase === "guess") {
        // Bailing mid-round forfeits the target rather than banking it.
        countdown.stop();
        setPhase("idle");
        if (run) setSaved({ run: rerollRound(run, roundIndex), armed: false });
      }
    }
    setTab(next);
  };

  const readWaveform = useCallback(() => synth.readWaveform(), [synth]);

  const lastGuess = run?.guesses[run.guesses.length - 1];
  const runScore = run ? run.guesses.reduce((a, g) => a + g.score, 0) : 0;
  const showRibbon =
    phase === "idle" || phase === "guess" || phase === "reveal";
  const displayRound = Math.min((run?.guesses.length ?? 0) + 1, ROUNDS);

  if (tab === 1) {
    return (
      <Stack spacing={2} sx={{ width: "100%" }}>
        <Tabs value={tab} onChange={(_, v) => switchTab(v)} centered>
          <Tab label="Play" />
          <Tab label="Stats" />
        </Tabs>
        <PitchStats
          guesses={guessLog}
          runs={runLog}
          onClear={() => {
            clearGuesses();
            clearRuns();
          }}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Tabs value={tab} onChange={(_, v) => switchTab(v)} centered>
        <Tab label="Play" />
        <Tab label="Stats" />
      </Tabs>

      <ScoreBar
        stats={[
          {
            label: "Round",
            value: phase === "summary" ? `${ROUNDS}/${ROUNDS}` : `${displayRound}/${ROUNDS}`,
          },
          { label: "This run", value: runScore.toFixed(1) },
          { label: "Best", value: best > 0 ? best.toFixed(1) : "—" },
        ]}
      />

      {phase === "summary" && run ? (
        <RunSummary
          guesses={run.guesses}
          best={best}
          isNewBest={newBest}
          onPlayAgain={startNewRun}
          onViewStats={() => switchTab(1)}
        />
      ) : null}

      {phase === "listen" ? (
        <Stack alignItems="center" spacing={2} sx={{ py: 2 }}>
          <CountdownRing
            remainingMs={countdown.remainingMs}
            totalMs={LISTEN_MS}
            caption="listen"
          />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Hold on to this pitch. You only hear it once.
          </Typography>
          <Button variant="outlined" onClick={finishListening}>
            I&apos;ve got it
          </Button>
        </Stack>
      ) : null}

      {phase === "gap" ? (
        <Stack alignItems="center" spacing={2} sx={{ py: 2 }}>
          <CountdownRing
            remainingMs={0}
            totalMs={LISTEN_MS}
            label="—"
            caption="hold it"
            pulse={false}
          />
          <Typography variant="body2" color="text.secondary">
            Now find it.
          </Typography>
        </Stack>
      ) : null}

      {showRibbon && run ? (
        <TuningRibbon
          startCents={run.startCents[roundIndex]}
          roundKey={run.guesses.length}
          interactive={phase === "guess"}
          reveal={
            phase === "reveal" && lastGuess
              ? {
                  guessCents: guessCentsRef.current,
                  targetCents: run.targetCents[run.guesses.length - 1],
                }
              : null
          }
          onChange={handleRibbonChange}
          onLock={lockIn}
          readWaveform={
            phase === "guess" || phase === "reveal" ? readWaveform : undefined
          }
          sampleRate={synth.sampleRate}
        />
      ) : null}

      {phase === "idle" && run ? (
        <Stack spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={<HeadphonesIcon />}
            onClick={beginRound}
            sx={{ py: 1.5, fontWeight: 700 }}
          >
            {run.guesses.length === 0
              ? "Play the first tone"
              : `Play tone — round ${displayRound}`}
          </Button>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            Four seconds of a single tone, then it&apos;s gone. Slide the ribbon
            until you find it again.
          </Typography>
        </Stack>
      ) : null}

      {phase === "guess" ? (
        <Stack spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={<LockIcon />}
            onClick={lockIn}
            sx={{ py: 1.5, fontWeight: 700 }}
          >
            Lock it in
          </Button>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            Drag the ribbon, and drag away from it for finer control · arrow
            keys nudge, Shift for bigger steps · Enter to lock
          </Typography>
        </Stack>
      ) : null}

      {phase === "reveal" && lastGuess ? (
        <RoundReveal
          guess={lastGuess}
          round={run?.guesses.length ?? 1}
          totalRounds={ROUNDS}
          onPlayTarget={() => replay(lastGuess.targetHz)}
          onPlayGuess={() => replay(lastGuess.guessHz)}
          onNext={goNext}
          nextLabel={
            run && isRunComplete(run) ? "See your results" : "Next round"
          }
        />
      ) : null}

      <Box sx={{ width: "100%" }}>
        <Stack direction="row" justifyContent="center">
          <IconButton
            size="small"
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Sound settings"
            sx={{ color: "text.secondary" }}
          >
            <TuneIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Collapse in={showSettings}>
          <Box sx={{ pt: 1 }}>
            <SoundSettings
              volume={volume}
              onVolume={setVolume}
              waveform={waveform}
              onWaveform={setWaveform}
            />
          </Box>
        </Collapse>
      </Box>

      <GameSidebar
        config={SIDEBAR}
        global={globalBoard}
        pendingScore={
          phase === "summary" && run ? Math.round(runScore) : null
        }
      />
    </Stack>
  );
}
