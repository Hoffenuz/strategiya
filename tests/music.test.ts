import { describe, expect, it } from 'vitest';
import { MOODS, midiToHz, moodFor, type Mood } from '../src/ui/music';

const pitchClasses = (notes: readonly number[]) => new Set(notes.map((n) => n % 12));
const MOOD_LIST: Mood[] = ['collapse', 'transition', 'revival'];

describe('generative soundtrack data (T11.4, R-11.18)', () => {
  it('converts MIDI notes to frequencies', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it('keeps pads low and bells high, in a gentle register', () => {
    for (const m of MOOD_LIST) {
      for (const chord of MOODS[m].chords) for (const n of chord) expect(n >= 36 && n <= 72, `${m} pad ${n}`).toBe(true);
      for (const n of MOODS[m].bells) expect(n >= 60 && n <= 96, `${m} bell ${n}`).toBe(true);
      expect(MOODS[m].chords.length).toBe(4);
    }
  });

  it('plays the documented scales: A minor, then G major, then C major pentatonic', () => {
    expect(pitchClasses(MOODS.collapse.bells)).toEqual(new Set([9, 0, 2, 4, 7]));
    expect(MOODS.collapse.bells[0]! % 12).toBe(9); // rooted on A
    expect(pitchClasses(MOODS.transition.bells)).toEqual(new Set([2, 4, 7, 9, 11]));
    expect(pitchClasses(MOODS.revival.bells)).toEqual(new Set([0, 2, 4, 7, 9]));
    expect(MOODS.revival.bells[0]! % 12).toBe(0); // rooted on C
    expect(MOODS.collapse.chords[0]![0]! % 12).toBe(9); // A minor first
    expect(MOODS.revival.chords[0]![0]! % 12).toBe(0); // C major first
  });

  it('grows brighter, busier and quicker as the valley heals', () => {
    const [c, t, r] = MOOD_LIST.map((m) => MOODS[m]);
    expect(c!.cutoff < t!.cutoff && t!.cutoff < r!.cutoff).toBe(true);
    expect(c!.bellChance < t!.bellChance && t!.bellChance < r!.bellChance).toBe(true);
    expect(c!.seconds > t!.seconds && t!.seconds > r!.seconds).toBe(true);
    for (const m of MOOD_LIST) expect(MOODS[m].bellChance > 0 && MOODS[m].bellChance < 0.5).toBe(true);
  });

  it('follows the world stage of the progress toward the goal', () => {
    expect(moodFor(0)).toBe('collapse');
    expect(moodFor(0.44)).toBe('collapse');
    expect(moodFor(0.5)).toBe('transition');
    expect(moodFor(0.95)).toBe('revival');
  });
});
