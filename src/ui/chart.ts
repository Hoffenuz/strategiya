import type { HistoryPoint } from '../core/state';

/** Geometry of the progress chart (R-11.20, design §7.7), in SVG user units. */
export const CHART = { width: 320, height: 150, left: 28, right: 8, top: 10, bottom: 22 } as const;

export interface ChartPoint {
  turn: number;
  x: number;
  restoredY: number;
  pollutionY: number;
}

export interface ChartSummary {
  turns: number;
  fromRestored: number;
  toRestored: number;
  fromPollution: number;
  toPollution: number;
  goal: number;
}

export interface ChartModel {
  points: ChartPoint[];
  /** SVG path data of the restoration line (solid). */
  restoration: string;
  /** SVG path data of the average-pollution line (dashed). */
  pollution: string;
  goalY: number;
  firstTurn: number;
  lastTurn: number;
  summary: ChartSummary;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Pure chart geometry; null until there are two points to join. */
export function chartModel(history: readonly HistoryPoint[], winRatio: number): ChartModel | null {
  if (history.length < 2) return null;
  const first = history[0]!;
  const last = history[history.length - 1]!;
  const span = Math.max(1, last.turn - first.turn);
  const plotW = CHART.width - CHART.left - CHART.right;
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const x = (turn: number) => CHART.left + ((turn - first.turn) / span) * plotW;
  const y = (pct: number) => CHART.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotH;
  const points = history.map((p) => ({ turn: p.turn, x: x(p.turn), restoredY: y(p.ratio * 100), pollutionY: y(p.pollution) }));
  const path = (key: 'restoredY' | 'pollutionY') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round1(p.x)} ${round1(p[key])}`).join(' ');
  return {
    points,
    restoration: path('restoredY'),
    pollution: path('pollutionY'),
    goalY: y(winRatio * 100),
    firstTurn: first.turn,
    lastTurn: last.turn,
    summary: {
      turns: last.turn,
      fromRestored: Math.round(first.ratio * 100),
      toRestored: Math.round(last.ratio * 100),
      fromPollution: Math.round(first.pollution),
      toPollution: Math.round(last.pollution),
      goal: Math.round(winRatio * 100),
    },
  };
}

export interface ChartLabels {
  /** Accessible summary of the whole chart. */
  aria: string;
  restored: string;
  pollution: string;
  goal: string;
  turn: string;
}

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The chart as inline SVG plus a text legend. Lines differ by style (solid, dashed,
 * dotted) and end markers (circle, square) as well as by color (R-13.2).
 */
export function chartElement(m: ChartModel, labels: ChartLabels): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'chart';
  const svg = el('svg', { viewBox: `0 0 ${CHART.width} ${CHART.height}`, role: 'img', 'aria-label': labels.aria });
  const plotBottom = CHART.height - CHART.bottom;
  const plotRight = CHART.width - CHART.right;
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = CHART.top + (1 - pct / 100) * (plotBottom - CHART.top);
    svg.append(el('line', { x1: CHART.left, x2: plotRight, y1: y, y2: y, class: 'chart-grid' }));
    if (pct % 50 === 0) svg.append(el('text', { x: CHART.left - 4, y: y + 3, class: 'chart-axis', 'text-anchor': 'end' }, `${pct}%`));
  }
  svg.append(el('text', { x: CHART.left, y: CHART.height - 6, class: 'chart-axis', 'text-anchor': 'start' }, String(m.firstTurn)));
  svg.append(el('text', { x: plotRight, y: CHART.height - 6, class: 'chart-axis', 'text-anchor': 'end' }, String(m.lastTurn)));
  svg.append(el('text', { x: (CHART.left + plotRight) / 2, y: CHART.height - 6, class: 'chart-axis', 'text-anchor': 'middle' }, labels.turn));
  svg.append(el('line', { x1: CHART.left, x2: plotRight, y1: m.goalY, y2: m.goalY, class: 'chart-goal' }));
  const lastPoint = m.points[m.points.length - 1]!;
  const firstPoint = m.points[0]!;
  const area = `${m.restoration} L${lastPoint.x} ${plotBottom} L${firstPoint.x} ${plotBottom} Z`;
  svg.append(el('path', { d: area, class: 'chart-area' }));
  svg.append(el('path', { d: m.pollution, class: 'chart-pollution' }));
  svg.append(el('path', { d: m.restoration, class: 'chart-restored' }));
  svg.append(el('circle', { cx: lastPoint.x, cy: lastPoint.restoredY, r: 4, class: 'chart-restored-dot' }));
  svg.append(el('rect', { x: lastPoint.x - 3.5, y: lastPoint.pollutionY - 3.5, width: 7, height: 7, class: 'chart-pollution-dot' }));
  figure.append(svg);
  const legend = document.createElement('figcaption');
  legend.className = 'chart-legend';
  const item = (cls: string, text: string) => {
    const span = document.createElement('span');
    span.className = 'chart-key';
    const sample = el('svg', { viewBox: '0 0 24 8', width: 24, height: 8, 'aria-hidden': 'true' });
    sample.append(el('line', { x1: 1, x2: 23, y1: 4, y2: 4, class: cls }));
    span.append(sample, document.createTextNode(text));
    return span;
  };
  legend.append(item('chart-restored', labels.restored), item('chart-pollution', labels.pollution), item('chart-goal', labels.goal));
  figure.append(legend);
  return figure;
}
