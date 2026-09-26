import { en, type TranslationKey } from './en';
import { uz } from './uz';

export type Lang = 'en' | 'uz';
export type { TranslationKey };

export const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, uz };
export const LANGS: readonly Lang[] = ['en', 'uz'];

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const fn of listeners) fn(lang);
}

export function getLang(): Lang {
  return current;
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate with {placeholder} substitution; falls back to English, then to the key. */
export function t(key: TranslationKey, params?: Record<string, string | number>, lang: Lang = current): string {
  const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
