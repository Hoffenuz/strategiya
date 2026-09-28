import { en, type TranslationKey } from './en';
import { ru } from './ru';
import { cyrillicDictionary } from './translit';
import { uz } from './uz';

/** Interface languages (R-12.1): English, Uzbek in Latin and Cyrillic script, Russian. */
export type Lang = 'en' | 'uz' | 'uz-Cyrl' | 'ru';
export type { TranslationKey };

export const LANGS: readonly Lang[] = ['en', 'uz', 'uz-Cyrl', 'ru'];

/** Each language named in its own script (R-12.5). */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', uz: "O'zbekcha", 'uz-Cyrl': 'Ўзбекча', ru: 'Русский' };
export const LANG_SHORT: Record<Lang, string> = { en: 'EN', uz: 'UZ', 'uz-Cyrl': 'ЎЗ', ru: 'RU' };

/** Uzbek Cyrillic is derived from Uzbek Latin, so the two can never drift apart (R-12.4). */
export const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, uz, 'uz-Cyrl': cyrillicDictionary(uz), ru };

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** First-run language from the browser: Uzbek Cyrillic, Uzbek, Russian, otherwise English. */
export function detectLang(browserLanguage: string): Lang {
  const tag = browserLanguage.toLowerCase();
  if (tag.startsWith('uz')) return tag.includes('cyrl') ? 'uz-Cyrl' : 'uz';
  if (tag.startsWith('ru')) return 'ru';
  return 'en';
}

/** The language after `lang` in the cycle of the language button. */
export function nextLang(lang: Lang): Lang {
  return LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!;
}

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
