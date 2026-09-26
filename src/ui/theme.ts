/**
 * HUD theme tokens (R-13.1). Applied as CSS custom properties at runtime, and checked by
 * an automated contrast test: text ≥ 4.5:1, large elements and icons ≥ 3:1.
 */
export interface Theme {
  bg: string;
  panel: string;
  panelRaised: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  gold: string;
  energy: string;
  good: string;
  bad: string;
  focus: string;
}

export const THEMES: Record<'default' | 'contrast', Theme> = {
  default: {
    bg: '#0f1418',
    panel: '#1a2229',
    panelRaised: '#243039',
    text: '#eef3ea',
    textMuted: '#b7c4bd',
    border: '#6d8290',
    accent: '#7fd18b',
    accentText: '#0b1a0f',
    gold: '#f5c84c',
    energy: '#7fd8ff',
    good: '#8fe39a',
    bad: '#ff9d8a',
    focus: '#ffd166',
  },
  contrast: {
    bg: '#000000',
    panel: '#000000',
    panelRaised: '#141414',
    text: '#ffffff',
    textMuted: '#e6e6e6',
    border: '#ffffff',
    accent: '#ffe600',
    accentText: '#000000',
    gold: '#ffd400',
    energy: '#5ce1ff',
    good: '#6dff7a',
    bad: '#ff8a8a',
    focus: '#00e5ff',
  },
};

/** Pairs that must meet 4.5:1 (body text) and 3:1 (large UI, icons, borders). */
export const TEXT_PAIRS: [keyof Theme, keyof Theme][] = [
  ['text', 'bg'],
  ['text', 'panel'],
  ['text', 'panelRaised'],
  ['textMuted', 'panel'],
  ['textMuted', 'panelRaised'],
  ['gold', 'panel'],
  ['energy', 'panel'],
  ['good', 'panel'],
  ['bad', 'panel'],
  ['accentText', 'accent'],
];

export const LARGE_PAIRS: [keyof Theme, keyof Theme][] = [
  ['border', 'panel'],
  ['border', 'bg'],
  ['accent', 'panel'],
  ['focus', 'panel'],
  ['focus', 'bg'],
];

export function applyTheme(root: HTMLElement, theme: Theme): void {
  for (const [k, v] of Object.entries(theme)) root.style.setProperty(`--${k}`, v);
}
