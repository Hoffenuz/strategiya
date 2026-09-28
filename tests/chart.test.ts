import { describe, expect, it } from 'vitest';
import { CHART, chartModel } from '../src/ui/chart';

const history = [
  { turn: 0, ratio: 0, pollution: 40 },
  { turn: 1, ratio: 0.05, pollution: 38.5 },
  { turn: 2, ratio: 0.2, pollution: 30 },
  { turn: 3, ratio: 0.5, pollution: 12 },
  { turn: 4, ratio: 0.66, pollution: 4 },
];

const plotW = CHART.width - CHART.left - CHART.right;
const plotH = CHART.height - CHART.top - CHART.bottom;

describe('progress chart model (T11.4, R-11.20)', () => {
  it('needs at least two points', () => {
    expect(chartModel([], 0.65)).toBeNull();
    expect(chartModel([history[0]!], 0.65)).toBeNull();
    expect(chartModel(history.slice(0, 2), 0.65)).not.toBeNull();
  });

  it('maps turns to x and percentages to y inside the plot area', () => {
    const m = chartModel(history, 0.65)!;
    expect(m.points).toHaveLength(5);
    expect(m.points[0]!.x).toBe(CHART.left);
    expect(m.points[4]!.x).toBe(CHART.left + plotW);
    expect(m.points[2]!.x).toBeCloseTo(CHART.left + plotW / 2, 9);
    // 0 % sits on the bottom edge, 100 % on the top edge.
    expect(m.points[0]!.restoredY).toBe(CHART.top + plotH);
    expect(m.points[0]!.pollutionY).toBeCloseTo(CHART.top + plotH * 0.6, 9);
    expect(m.points[3]!.restoredY).toBeCloseTo(CHART.top + plotH * 0.5, 9);
    expect(m.goalY).toBeCloseTo(CHART.top + plotH * 0.35, 9);
    for (const p of m.points) {
      for (const y of [p.restoredY, p.pollutionY]) expect(y >= CHART.top && y <= CHART.top + plotH).toBe(true);
    }
  });

  it('builds one path per series through every point', () => {
    const m = chartModel(history, 0.65)!;
    for (const d of [m.restoration, m.pollution]) {
      expect(d.startsWith('M')).toBe(true);
      expect(d.match(/L/g)).toHaveLength(4);
    }
  });

  it('summarises where the game started and ended', () => {
    const m = chartModel(history, 0.65)!;
    expect(m.summary).toEqual({ turns: 4, fromRestored: 0, toRestored: 66, fromPollution: 40, toPollution: 4, goal: 65 });
  });
});
