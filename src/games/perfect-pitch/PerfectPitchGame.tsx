"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
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
import OnlineSubmit from "./OnlineSubmit";
import PitchStats from "./PitchStats";
import RoundReveal from "./RoundReveal";
import { useOnlineRun } from "./useOnlineRun";
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
  centsAtHz,
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

/**
 * Online runs are scored by the server, one round at a time, and are the only
 * ones eligible for the global board. Offline runs never touch the network and
 * never leave this browser.
 */
type Mode = "online" | "offline";

/** Device-level input hint. Not identifying, and it answers whether phone
 *  players are at a disadvantage on a ribbon this narrow. */
function coarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

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

  const [mode, setMode] = useLocalStorage<Mode>(`minigames:${SLUG}:mode`, "online");
  const online = useOnlineRun();
  const {
    round: onlineRound,
    available: onlineAvailable,
    busy: onlineBusy,
    error: onlineError,
    start: startOnline,
    resume: resumeOnline,
    submitGuess: submitOnlineGuess,
    submitToBoard,
    reset: resetOnline,
  } = online;

  // A server that can't take runs shouldn't take the game with it: fall back
  // to offline play rather than showing an error where the game should be.
  const isOnline = mode === "online" && onlineAvailable !== false;

  const run = saved?.run ?? null;
  const roundIndex = run ? Math.min(run.guesses.length, ROUNDS - 1) : 0;

  // Whichever source is driving this run, the rest of the component sees the
  // same three things: the guesses so far, and the current round's target and
  // starting position.
  const activeGuesses = isOnline ? online.guesses : (run?.guesses ?? []);
  const activeTargetCents = isOnline
    ? onlineRound
      ? centsAtHz(onlineRound.targetHz)
      : null
    : (run?.targetCents[roundIndex] ?? null);
  const activeStartCents = isOnline
    ? (onlineRound?.startCents ?? null)
    : (run?.startCents[roundIndex] ?? null);
  const activeComplete = activeGuesses.length >= ROUNDS;

  // Mirrored into refs so the phase callbacks can read the current round
  // without listing two more changing values in every dependency array.
  const targetCentsRef = useRef<number | null>(null);
  targetCentsRef.current = activeTargetCents;
  const startCentsRef = useRef<number | null>(null);
  startCentsRef.current = activeStartCents;
  // Which round the server thinks we're on. Sent back with the guess so a
  // retry can't be applied to the wrong one.
  const serverRoundIndexRef = useRef(0);
  if (onlineRound) serverRoundIndexRef.current = onlineRound.index;

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
      const start = startCentsRef.current;
      if (start === null) return;
      guessCentsRef.current = start;
      synth.start(hzAtCents(start), TONE_FADE_IN_MS);
      huntStartRef.current = performance.now();
      // Seed with the starting position so a round where nobody touches the
      // ribbon still has a first point to measure against.
      trajectoryRef.current = [{ t: 0, cents: start }];
      setPhase("guess");
    });
  }, [after, clearTimers, setPhase, synth]);

  const countdown = useCountdown(finishListening);
  stopCountdownRef.current = countdown.stop;

  const startCountdown = countdown.start;
  const beginRound = useCallback(async () => {
    await synth.resume();
    synth.setWaveform(waveform);
    synth.setVolume(volume);

    let targetCents: number;
    let startCents: number;

    if (isOnline) {
      // Round N+1 only exists once round N has been answered, so the server is
      // asked for it here rather than a run being planned up front.
      const served =
        onlineRound ?? (await resumeOnline()) ?? (await startOnline());
      if (!served) return; // the hook has already dropped us to offline
      targetCents = centsAtHz(served.targetHz);
      startCents = served.startCents;
      serverRoundIndexRef.current = served.index;
    } else {
      if (!run) return;
      setSaved({ run, armed: true });
      targetCents = run.targetCents[roundIndex];
      startCents = run.startCents[roundIndex];
    }

    targetCentsRef.current = targetCents;
    startCentsRef.current = startCents;

    clearTimers();
    listenStartRef.current = performance.now();
    setPhase("listen");
    synth.start(hzAtCents(targetCents), TONE_FADE_IN_MS);
    startCountdown(LISTEN_MS);
    // The ring runs on animation frames, which stop in a background tab. This
    // backstop is what actually guarantees the tone ends after four seconds.
    after(LISTEN_MS + 120, finishListening);
  }, [
    after,
    clearTimers,
    finishListening,
    isOnline,
    onlineRound,
    resumeOnline,
    roundIndex,
    run,
    setPhase,
    setSaved,
    startCountdown,
    startOnline,
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

  const lockIn = useCallback(async () => {
    if (phaseRef.current !== "guess") return;
    const targetCents = targetCentsRef.current;
    const startCents = startCentsRef.current;
    if (targetCents === null || startCents === null) return;

    const huntMs = Math.round(performance.now() - huntStartRef.current);
    const trace = downsample(trajectoryRef.current, TRAJECTORY_SAMPLES);
    const features = analyzeTrajectory(trace, huntMs);
    const listenMs = Math.round(listenMsRef.current);

    synth.stop(200);

    let guess: Guess | null;
    if (isOnline) {
      // The server holds the target and does the arithmetic; we send only what
      // we did, and are told how it went.
      guess = await submitOnlineGuess({
        roundIndex: serverRoundIndexRef.current,
        guessCents: guessCentsRef.current,
        listenMs,
        huntMs,
        pointerType: coarsePointer() ? "touch" : "mouse",
        trajectory: trace,
        features,
        startCents,
        waveform,
      });
      if (!guess) {
        // Rejected or unreachable. Don't invent a result — go back to idle and
        // let the player start the round again.
        setPhase("idle");
        return;
      }
    } else {
      if (!run) return;
      guess = scoreGuess(targetCents, guessCentsRef.current, {
        listenMs,
        huntMs,
        waveform,
        at: Date.now(),
        startCents,
        traj: features,
      });
      const nextRun = submitGuess(run, guess);
      setSaved({ run: nextRun, armed: false });
    }

    appendGuess(guess);

    // Recorded here rather than on the summary screen, so closing the tab on
    // the last reveal doesn't lose the run.
    const all = [...activeGuesses, guess];
    if (all.length >= ROUNDS) {
      const record = summarizeRun(
        { targetCents: [], startCents: [], guesses: all },
        waveform,
      );
      appendRun(record);
      setNewBest(submitBest(record.totalScore));
    }

    setPhase("reveal");
    clearTimers();
    // Let the ribbon finish travelling to the answer before the tone returns.
    const targetHz = guess.targetHz;
    after(900, () => synth.start(targetHz, 120));
    after(900 + REPLAY_MS, () => synth.stop(260));
  }, [
    activeGuesses,
    after,
    appendGuess,
    appendRun,
    clearTimers,
    isOnline,
    run,
    setPhase,
    setSaved,
    submitBest,
    submitOnlineGuess,
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
    setPhase(activeComplete ? "summary" : "idle");
  }, [activeComplete, clearTimers, setPhase, synth]);

  const startNewRun = useCallback(() => {
    clearTimers();
    synth.stop(160);
    setNewBest(false);
    // Both sources get reset: switching modes mid-session shouldn't inherit
    // half a run from the other one.
    resetOnline();
    setSaved({ run: createRun(), armed: false });
    setPhase("idle");
  }, [clearTimers, resetOnline, setPhase, setSaved, synth]);

  const changeMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      clearTimers();
      synth.stop(160);
      countdown.stop();
      setNewBest(false);
      resetOnline();
      setSaved({ run: createRun(), armed: false });
      setMode(next);
      setPhase("idle");
    },
    [clearTimers, countdown, mode, resetOnline, setMode, setPhase, setSaved, synth],
  );

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

  const lastGuess = activeGuesses[activeGuesses.length - 1];
  const runScore = activeGuesses.reduce((a, g) => a + g.score, 0);
  const showRibbon =
    phase === "idle" || phase === "guess" || phase === "reveal";
  const displayRound = Math.min(activeGuesses.length + 1, ROUNDS);
  const ribbonStart = activeStartCents ?? 0;

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

      {phase === "summary" ? (
        <>
          <RunSummary
            guesses={activeGuesses}
            best={best}
            isNewBest={newBest}
            onPlayAgain={startNewRun}
            onViewStats={() => switchTab(1)}
          />
          {isOnline ? (
            <OnlineSubmit
              total={runScore}
              name={globalBoard.name}
              busy={onlineBusy}
              onSubmit={async (name) => {
                const result = await submitToBoard(name);
                // The board component owns the entry list; nudge it rather
                // than duplicating what it already knows how to fetch.
                if (result) {
                  globalBoard.setName(name);
                  globalBoard.refresh();
                }
                return result;
              }}
            />
          ) : (
            <Typography
              variant="caption"
              color="text.secondary"
              textAlign="center"
            >
              Offline runs stay in this browser and aren&apos;t eligible for the
              global board.
            </Typography>
          )}
        </>
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

      {showRibbon ? (
        <TuningRibbon
          startCents={ribbonStart}
          roundKey={activeGuesses.length}
          interactive={phase === "guess"}
          reveal={
            phase === "reveal" && lastGuess
              ? {
                  guessCents: guessCentsRef.current,
                  // Taken from the answered guess rather than the round plan,
                  // so it works whether the target came from here or the server.
                  targetCents: centsAtHz(lastGuess.targetHz),
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

      {phase === "idle" ? (
        <Stack spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={onlineBusy}
            startIcon={<HeadphonesIcon />}
            onClick={beginRound}
            sx={{ py: 1.5, fontWeight: 700 }}
          >
            {activeGuesses.length === 0
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
          round={activeGuesses.length}
          totalRounds={ROUNDS}
          onPlayTarget={() => replay(lastGuess.targetHz)}
          onPlayGuess={() => replay(lastGuess.guessHz)}
          onNext={goNext}
          nextLabel={activeComplete ? "See your results" : "Next round"}
        />
      ) : null}

      <Box sx={{ width: "100%" }}>
        <Stack direction="row" justifyContent="center" alignItems="center" spacing={1}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={isOnline ? "online" : "offline"}
            disabled={phase !== "idle" && phase !== "summary"}
            onChange={(_, v: Mode | null) => v && changeMode(v)}
          >
            <ToggleButton value="online" sx={{ px: 1.5, fontSize: "0.7rem" }}>
              Ranked
            </ToggleButton>
            <ToggleButton value="offline" sx={{ px: 1.5, fontSize: "0.7rem" }}>
              Practice
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton
            size="small"
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Sound settings"
            sx={{ color: "text.secondary" }}
          >
            <TuneIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", textAlign: "center", mt: 0.75 }}
        >
          {onlineAvailable === false
            ? "Ranked play is unavailable — playing offline."
            : isOnline
              ? "Ranked: the server picks each tone and scores your guess."
              : "Practice: nothing leaves this browser, nothing is ranked."}
        </Typography>

        {onlineError && isOnline ? (
          <Typography
            variant="caption"
            color="error"
            sx={{ display: "block", textAlign: "center" }}
          >
            {onlineError}
          </Typography>
        ) : null}

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

      {/*
        pendingScore stays null: the shared prompt posts a score the client
        calculated, which is exactly what this game can't allow. Submission
        goes through OnlineSubmit against the server-held run instead.
      */}
      <GameSidebar config={SIDEBAR} global={globalBoard} pendingScore={null} />
    </Stack>
  );
}
