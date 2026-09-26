import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { uz } from '../src/i18n/uz';
import { placeholders, t } from '../src/i18n';

describe('localization (T1.10)', () => {
  it('Uzbek has exactly the English keys', () => {
    expect(Object.keys(uz).sort()).toEqual(Object.keys(en).sort());
  });

  it('every translation keeps the same placeholders and is non-empty', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(uz[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(uz[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('substitutes parameters', () => {
    expect(t('log.salvaged', { gold: 10 }, 'en')).toBe('Salvaged ruin for 10 Gold.');
    expect(t('log.salvaged', { gold: 10 }, 'uz')).toBe('Xaroba qayta ishlandi: 10 Oltin.');
  });
});
