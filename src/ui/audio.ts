import type { EventBus } from '../core/events';

type Cue = { freq: number[]; dur: number; type: OscillatorType; gain: number };

const CUES: Record<string, Cue> = {
  build: { freq: [392, 523], dur: 0.09, type: 'triangle', gain: 0.12 },
  plant: { freq: [523, 659, 784], dur: 0.07, type: 'sine', gain: 0.12 },
  gold: { freq: [880, 1175], dur: 0.06, type: 'square', gain: 0.05 },
  reject: { freq: [196, 165], dur: 0.1, type: 'sawtooth', gain: 0.05 },
  turn: { freq: [330, 392, 494], dur: 0.08, type: 'triangle', gain: 0.08 },
  restore: { freq: [659, 880], dur: 0.08, type: 'sine', gain: 0.1 },
  milestone: { freq: [523, 659, 784, 1047], dur: 0.12, type: 'triangle', gain: 0.14 },
  bad: { freq: [220, 185, 147], dur: 0.14, type: 'sawtooth', gain: 0.06 },
  win: { freq: [523, 659, 784, 1047, 1319], dur: 0.16, type: 'triangle', gain: 0.15 },
};

/** Synthesized audio cues subscribed to the bus (R-11.6); no asset files. */
export class Audio {
  private ctx: AudioContext | null = null;
  enabled = true;

  constructor(bus: EventBus) {
    bus.on('building:placed', () => this.play('build'));
    bus.on('building:upgraded', () => this.play('build'));
    bus.on('flora:planted', () => this.play('plant'));
    bus.on('tile:salvaged', () => this.play('gold'));
    bus.on('action:rejected', () => this.play('reject'));
    bus.on('turn:started', () => this.play('turn'));
    bus.on('tile:restored', () => this.play('restore'));
    bus.on('ecosystem:milestone', () => this.play('milestone'));
    bus.on('flora:withered', () => this.play('bad'));
    bus.on('game:lost', () => this.play('bad'));
    bus.on('game:won', () => this.play('win'));
    bus.on('event:random', (e) => this.play(e.kind === 'acidRain' ? 'bad' : 'restore'));
  }

  /** Must be called from a user gesture before sound can play. */
  unlock(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  private lastPlayed = new Map<string, number>();

  play(name: keyof typeof CUES): void {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Throttle bursts (e.g. many tiles restored in one turn).
    if ((this.lastPlayed.get(name) ?? -1) > now - 0.12) return;
    this.lastPlayed.set(name, now);
    const cue = CUES[name]!;
    cue.freq.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = cue.type;
      osc.frequency.value = f;
      const t0 = now + i * cue.dur;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(cue.gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + cue.dur);
      osc.connect(g).connect(this.ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + cue.dur + 0.02);
    });
  }
}
