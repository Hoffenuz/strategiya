import { isLang, type Lang } from '../i18n';

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'activate' | 'endTurn' | 'undo' | 'cancel' | 'nextTool' | 'prevTool' | 'hint' | 'lens';

export const KEY_ACTIONS: readonly KeyAction[] = ['up', 'down', 'left', 'right', 'activate', 'endTurn', 'undo', 'cancel', 'nextTool', 'prevTool', 'hint', 'lens'];

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  activate: 'Enter',
  endTurn: 'KeyE',
  undo: 'KeyZ',
  cancel: 'Escape',
  nextTool: 'BracketRight',
  prevTool: 'BracketLeft',
  hint: 'KeyH',
  lens: 'KeyL',
};

/** Keys reserved for tool shortcuts (1–9) and so never remappable to other actions. */
export const RESERVED_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Tab'];

export const SCALES = [1, 1.25, 1.5, 1.75, 2] as const;

export interface Settings {
  lang: Lang;
  scale: number;
  highContrast: boolean;
  reducedMotion: boolean;
  sound: boolean;
  /** The generative soundtrack, separate from sound effects (R-11.18). */
  music: boolean;
  patterns: boolean;
  tutorial: boolean;
  keys: Record<KeyAction, string>;
}

export function defaultSettings(prefersReducedMotion = false, lang: Lang = 'en'): Settings {
  return {
    lang,
    scale: 1,
    highContrast: false,
    reducedMotion: prefersReducedMotion,
    sound: true,
    music: true,
    patterns: true,
    tutorial: true,
    keys: { ...DEFAULT_KEYS },
  };
}

/** Merges stored JSON over defaults, dropping anything malformed. */
export function parseSettings(json: string | null, defaults: Settings): Settings {
  if (!json) return defaults;
  try {
    const raw = JSON.parse(json) as Partial<Settings>;
    const out: Settings = { ...defaults, keys: { ...defaults.keys } };
    if (isLang(raw.lang)) out.lang = raw.lang;
    if (typeof raw.scale === 'number' && (SCALES as readonly number[]).includes(raw.scale)) out.scale = raw.scale;
    for (const k of ['highContrast', 'reducedMotion', 'sound', 'music', 'patterns', 'tutorial'] as const) {
      if (typeof raw[k] === 'boolean') out[k] = raw[k];
    }
    if (raw.keys && typeof raw.keys === 'object') {
      for (const a of KEY_ACTIONS) {
        const code = (raw.keys as Record<string, unknown>)[a];
        if (typeof code === 'string' && code.length > 0) out.keys[a] = code;
      }
      // A corrupted map with duplicates falls back to defaults entirely.
      if (new Set(Object.values(out.keys)).size !== KEY_ACTIONS.length) out.keys = { ...DEFAULT_KEYS };
    }
    return out;
  } catch {
    return defaults;
  }
}

export type RebindResult = { ok: true; keys: Record<KeyAction, string> } | { ok: false; conflict: KeyAction | 'reserved' };

/** Remaps one action, refusing codes used by another action or reserved (R-13.5). */
export function rebind(keys: Record<KeyAction, string>, action: KeyAction, code: string): RebindResult {
  if (RESERVED_CODES.includes(code)) return { ok: false, conflict: 'reserved' };
  for (const a of KEY_ACTIONS) if (a !== action && keys[a] === code) return { ok: false, conflict: a };
  return { ok: true, keys: { ...keys, [action]: code } };
}

export function actionForCode(keys: Record<KeyAction, string>, code: string): KeyAction | null {
  for (const a of KEY_ACTIONS) if (keys[a] === code) return a;
  return null;
}

/** Human-readable key label: "KeyE" → "E", "ArrowUp" → "↑". */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Escape') return 'Esc';
  if (code === 'Space') return 'Space';
  return code;
}
