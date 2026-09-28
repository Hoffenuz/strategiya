import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { uz } from '../src/i18n/uz';
import { ru } from '../src/i18n/ru';
import { DICTIONARIES, LANG_NAMES, LANGS, detectLang, placeholders, t } from '../src/i18n';

describe('localization (T1.10, T13.1)', () => {
  it('offers English, Uzbek (Latin and Cyrillic) and Russian', () => {
    expect(LANGS).toEqual(['en', 'uz', 'uz-Cyrl', 'ru']);
    expect(LANG_NAMES).toEqual({ en: 'English', uz: "O'zbekcha", 'uz-Cyrl': 'Ўзбекча', ru: 'Русский' });
  });

  it('every dictionary has exactly the English keys', () => {
    for (const dict of [uz, ru, DICTIONARIES['uz-Cyrl']]) expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
  });

  it('every translation keeps the same placeholders and is non-empty', () => {
    for (const lang of LANGS) {
      const dict = DICTIONARIES[lang];
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(dict[key].trim().length, `${lang}:${key}`).toBeGreaterThan(0);
        expect(placeholders(dict[key]), `${lang}:${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it('Russian is written in Cyrillic (Latin only for names, keys and the brand)', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const rest = ru[key].replace(/\{\w+\}|Terra Revival|Terra|Enter|Esc|\b[A-Z]\b/g, '');
      expect(/[A-Za-z]/.test(rest), `${key}: ${ru[key]}`).toBe(false);
    }
  });

  it('substitutes parameters', () => {
    expect(t('log.salvaged', { gold: 10 }, 'en')).toBe('Salvaged ruin for 10 Gold.');
    expect(t('log.salvaged', { gold: 10 }, 'uz')).toBe('Xaroba qayta ishlandi: 10 Oltin.');
    expect(t('log.salvaged', { gold: 10 }, 'uz-Cyrl')).toBe('Хароба қайта ишланди: 10 Олтин.');
    expect(t('log.salvaged', { gold: 10 }, 'ru')).toBe('Руины переработаны: +10 золота.');
  });

  it('picks the first language from the browser', () => {
    expect(detectLang('uz-Cyrl-UZ')).toBe('uz-Cyrl');
    expect(detectLang('uz-cyrl')).toBe('uz-Cyrl');
    expect(detectLang('uz-UZ')).toBe('uz');
    expect(detectLang('uz')).toBe('uz');
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('en-GB')).toBe('en');
    expect(detectLang('de')).toBe('en');
    expect(detectLang('')).toBe('en');
  });
});
