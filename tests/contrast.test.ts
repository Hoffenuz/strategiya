import { describe, expect, it } from 'vitest';
import { contrast } from '../src/render/color';
import { LARGE_PAIRS, TEXT_PAIRS, THEMES } from '../src/ui/theme';

describe('WCAG contrast of HUD theme tokens (R-13.1, T6.1)', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: body text ≥ 4.5:1`, () => {
      for (const [fg, bg] of TEXT_PAIRS) expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: large elements ≥ 3:1`, () => {
      for (const [fg, bg] of LARGE_PAIRS) expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }
  it('known reference: black on white is 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});
