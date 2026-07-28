/**
 * A single-voice Web Audio tone generator with perceptual loudness matching.
 *
 * Framework-agnostic on purpose — see useToneSynth for the React wrapper. Any
 * game that needs to play a clean pitch should reach for this rather than
 * wiring up its own AudioContext.
 */

/** Raw sample amplitude before loudness weighting and user volume. */
const BASE_AMPLITUDE = 0.4;

/**
 * How much of the A-weighting curve to undo. A-weighting is calibrated for
 * quiet listening and applying all of it makes the bass overwhelming, so we
 * take a bit over half of the correction. Tunable by ear.
 */
const LOUDNESS_COMPENSATION = 0.6;

/** Portamento time constant. Short enough to feel instant, long enough that
 *  dragging the slider doesn't produce zipper noise. */
const GLIDE_TIME = 0.012;

/**
 * A-weighting in dB — a standard approximation of how sensitive the ear is at
 * a given frequency. Roughly -16 dB at 130 Hz, 0 dB at 1 kHz, +1 dB at 2.5 kHz.
 */
function aWeightingDb(hz: number): number {
  const f2 = hz * hz;
  const numerator = 12194 * 12194 * f2 * f2;
  const denominator =
    (f2 + 20.6 * 20.6) *
    Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
    (f2 + 12194 * 12194);
  return 20 * Math.log10(numerator / denominator) + 2.0;
}

/**
 * Gain multiplier that makes every frequency land at roughly the same
 * *perceived* loudness. Without this a low tone is inaudible on a laptop and a
 * high one is painful — and worse, "that one sounded loud" becomes a free clue
 * about where in the range the target sat.
 *
 * Normalised against `referenceHz` (the loudest-weighted end of the range) so
 * the result never exceeds 1 and can't clip.
 */
export function loudnessWeight(hz: number, referenceHz: number): number {
  const db = -aWeightingDb(hz) * LOUDNESS_COMPENSATION;
  const refDb = -aWeightingDb(referenceHz) * LOUDNESS_COMPENSATION;
  return Math.pow(10, (db - refDb) / 20);
}

export interface ToneSynthOptions {
  /** Frequency used to normalise the loudness curve. Pass the bottom of your
   *  playable range so nothing else can be louder than it. */
  referenceHz: number;
}

export class ToneSynth {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Matches the analyser's fftSize; reused every frame to avoid churn. */
  private scopeBuffer = new Float32Array(2048);

  private type: OscillatorType = "sine";
  private volume = 0.8;
  private hz = 440;
  private readonly referenceHz: number;

  constructor(options: ToneSynthOptions) {
    this.referenceHz = options.referenceHz;
  }

  /** True once the browser has actually handed us a running audio clock. */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  get playing(): boolean {
    return this.osc !== null;
  }

  /**
   * Must be called from a user gesture — browsers refuse to start audio
   * otherwise. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();

      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;

      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // Blocked by autoplay policy. The next gesture gets another shot.
      }
    }
  }

  /** Peak amplitude for the current frequency and volume setting. */
  private targetGain(): number {
    return (
      BASE_AMPLITUDE * this.volume * loudnessWeight(this.hz, this.referenceHz)
    );
  }

  /** Fades a tone in at `hz`. Restarts cleanly if one is already sounding. */
  start(hz: number, fadeMs = 60): void {
    if (!this.ctx || !this.gain) return;

    this.cancelPendingStop();
    this.hz = hz;

    if (!this.osc) {
      this.osc = this.ctx.createOscillator();
      this.osc.type = this.type;
      this.osc.frequency.value = hz;
      this.osc.connect(this.gain);
      this.osc.start();
    } else {
      this.osc.frequency.setValueAtTime(hz, this.ctx.currentTime);
    }

    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(
      this.targetGain(),
      now + fadeMs / 1000,
    );
  }

  /**
   * Glides to a new frequency. Called on every pointer move while the player
   * hunts, so it deliberately avoids allocating or rescheduling anything.
   */
  setFrequency(hz: number): void {
    this.hz = hz;
    if (!this.ctx || !this.osc || !this.gain) return;

    const now = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(hz, now, GLIDE_TIME);
    // The loudness weight moves with the frequency, so the gain has to track
    // it — otherwise sliding upward audibly fades out.
    this.gain.gain.setTargetAtTime(this.targetGain(), now, GLIDE_TIME);
  }

  /** Fades out and tears the oscillator down once it's silent. */
  stop(fadeMs = 300): void {
    if (!this.ctx || !this.gain || !this.osc) return;

    const now = this.ctx.currentTime;
    const osc = this.osc;
    this.osc = null;

    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);

    this.cancelPendingStop();
    // Stopping mid-ramp would click, so wait out the fade first.
    this.stopTimer = setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Already stopped — nothing to clean up.
      }
      this.stopTimer = null;
    }, fadeMs + 40);
  }

  setWaveform(type: Waveformish): void {
    this.type = type;
    if (this.osc) this.osc.type = type;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.ctx && this.gain && this.osc) {
      this.gain.gain.setTargetAtTime(
        this.targetGain(),
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  /**
   * Current output samples, for drawing an oscilloscope. Returns null when
   * there's no graph yet. The buffer is reused between calls — copy it if you
   * need to hold on to a frame.
   */
  readWaveform(): Float32Array | null {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.scopeBuffer);
    return this.scopeBuffer;
  }

  /** Samples per second, needed to draw a fixed time window. */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  private cancelPendingStop(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  dispose(): void {
    this.cancelPendingStop();
    try {
      this.osc?.stop();
    } catch {
      // Never started.
    }
    this.osc = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

type Waveformish = OscillatorType;
