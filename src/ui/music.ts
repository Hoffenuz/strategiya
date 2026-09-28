import { worldStage, type WorldStage } from '../core/selectors';

/**
 * A quiet generative soundtrack that heals with the valley (R-11.18, design §7.6).
 * The mood follows the world stage; the store only calls `setMood`, never the reverse.
 */
export type Mood = WorldStage;

export interface MoodDef {
  /** Four pad chords as MIDI notes, one every `seconds`. */
  chords: readonly (readonly number[])[];
  seconds: number;
  /** Low-pass cutoff of the mood's bus, in Hz. */
  cutoff: number;
  /** Bell notes (MIDI) and the chance of a bell on each half-second beat. */
  bells: readonly number[];
  bellChance: number;
}

export const MOODS: Record<Mood, MoodDef> = {
  // Industrial Collapse: A minor, dark and sparse.
  collapse: {
    chords: [
      [45, 52, 57, 60], // Am
      [41, 48, 53, 57], // F
      [50, 57, 62, 65], // Dm
      [40, 47, 52, 55], // Em
    ],
    seconds: 8,
    cutoff: 700,
    bells: [69, 72, 74, 76, 79], // A minor pentatonic
    bellChance: 0.1,
  },
  // Transition: warm, open, suspended.
  transition: {
    chords: [
      [50, 57, 62, 64], // Dsus2
      [48, 55, 60, 64], // C
      [45, 52, 55, 60], // Am7
      [43, 50, 59, 64], // G6
    ],
    seconds: 7,
    cutoff: 1300,
    bells: [74, 76, 79, 81, 83], // G major pentatonic
    bellChance: 0.22,
  },
  // Ecological Revival: bright major with bells.
  revival: {
    chords: [
      [48, 55, 59, 62, 64], // Cmaj9
      [41, 48, 52, 57], // Fmaj7
      [45, 52, 55, 60], // Am7
      [43, 50, 59, 64], // G6
    ],
    seconds: 6,
    cutoff: 2400,
    bells: [72, 74, 76, 79, 81, 84], // C major pentatonic
    bellChance: 0.34,
  },
};

export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function moodFor(progress: number): Mood {
  return worldStage(progress);
}

const MASTER = 0.07;
const CROSSFADE = 3;
const LOOKAHEAD = 1;
const TICK_MS = 250;
const BEAT = 0.5;
const ATTACK = 1.6;
const RELEASE = 2.4;
const MOOD_LIST: readonly Mood[] = ['collapse', 'transition', 'revival'];

interface Bus {
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** Schedules pads and bells ahead on the audio clock, so timing never depends on frames. */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: DelayNode | null = null;
  private buses = new Map<Mood, Bus>();
  private mood: Mood = 'transition';
  private enabled = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextChordAt = 0;
  private nextBeatAt = 0;
  private chordIndex = 0;

  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly rand: () => number = Math.random,
  ) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const ctx = this.ctx;
        if (!ctx) return;
        if (document.hidden) void ctx.suspend().catch(() => undefined);
        else if (this.enabled) void ctx.resume().catch(() => undefined);
      });
    }
  }

  /** Call after the audio context exists (a user gesture unlocked it). */
  start(): void {
    const ctx = this.getContext();
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? MASTER : 0;
    master.connect(ctx.destination);
    this.master = master;
    // A soft echo for the bells.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 1800;
    echo.connect(feedback).connect(echo);
    echo.connect(echoTone).connect(master);
    this.echo = echo;
    for (const m of MOOD_LIST) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = MOODS[m].cutoff;
      filter.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.value = m === this.mood ? 1 : 0;
      filter.connect(gain).connect(master);
      this.buses.set(m, { filter, gain });
    }
    this.nextChordAt = ctx.currentTime + 0.1;
    this.nextBeatAt = ctx.currentTime + 1.5;
    if (this.enabled) this.run();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? MASTER : 0, now, 0.3);
    if (on) {
      void ctx.resume().catch(() => undefined);
      this.nextChordAt = Math.max(this.nextChordAt, now + 0.1);
      this.nextBeatAt = Math.max(this.nextBeatAt, now + 1);
      this.run();
    } else this.halt();
  }

  /** Crossfades to the mood of the current world stage. */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [m, bus] of this.buses) {
      bus.gain.gain.cancelScheduledValues(now);
      bus.gain.gain.setValueAtTime(bus.gain.gain.value, now);
      bus.gain.gain.linearRampToValueAtTime(m === mood ? 1 : 0, now + CROSSFADE);
    }
    this.chordIndex = 0;
  }

  private run(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
  }

  private halt(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private readonly tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    // After a long pause (hidden tab) do not replay the missed notes.
    if (this.nextChordAt < ctx.currentTime - 1) this.nextChordAt = ctx.currentTime + 0.1;
    if (this.nextBeatAt < ctx.currentTime - 1) this.nextBeatAt = ctx.currentTime + 0.5;
    const def = MOODS[this.mood];
    while (this.nextChordAt < horizon) {
      this.pad(def, this.nextChordAt);
      this.nextChordAt += def.seconds;
    }
    while (this.nextBeatAt < horizon) {
      if (this.rand() < def.bellChance) this.bell(def, this.nextBeatAt);
      this.nextBeatAt += BEAT;
    }
  };

  private pad(def: MoodDef, t: number): void {
    const ctx = this.ctx!;
    const bus = this.buses.get(this.mood)!;
    const chord = def.chords[this.chordIndex++ % def.chords.length]!;
    const end = t + def.seconds + RELEASE;
    const level = 0.2 / chord.length;
    for (const note of chord) {
      for (const [type, detune] of [
        ['triangle', 1],
        ['sine', 1.003],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToHz(note) * detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + ATTACK);
        g.gain.setValueAtTime(level, t + def.seconds);
        g.gain.linearRampToValueAtTime(0, end);
        osc.connect(g).connect(bus.filter);
        osc.start(t);
        osc.stop(end + 0.05);
      }
    }
  }

  private bell(def: MoodDef, t: number): void {
    const ctx = this.ctx!;
    const bus = this.buses.get(this.mood)!;
    const note = def.bells[Math.floor(this.rand() * def.bells.length)]!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g);
    g.connect(bus.filter);
    if (this.echo) g.connect(this.echo);
    osc.start(t);
    osc.stop(t + 1.5);
  }
}
