import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { uz } from '../src/i18n/uz';
import { uzLatinToCyrillic, PROTECTED } from '../src/i18n/translit';

describe('Uzbek Latin → Cyrillic transliteration (T13.1, R-12.4)', () => {
  it('converts words by the rules of the Uzbek Cyrillic alphabet', () => {
    const pairs: [string, string][] = [
      ["O'zbekcha", 'Ўзбекча'],
      ["yo'q", 'йўқ'],
      ['Yer', 'Ер'],
      ['yetadi', 'етади'],
      ['Energiya', 'Энергия'],
      ["G'alaba", 'Ғалаба'],
      ["Mag'lubiyat", 'Мағлубият'],
      ["Qo'riqchi", 'Қўриқчи'],
      ["ma'lumot", 'маълумот'],
      ['Shamol', 'Шамол'],
      ['Choy', 'Чой'],
      ['Tayyorgarlik', 'Тайёргарлик'],
      ['Daryolar', 'Дарёлар'],
      ['Akkumulyator', 'Аккумулятор'],
      ['Menyu', 'Меню'],
      ['Eman daraxti', 'Эман дарахти'],
      ['Davom etish', 'Давом этиш'],
      ['Yangi o‘yin', 'Янги ўйин'],
      ['Harakat', 'Ҳаракат'],
      ['Xush kelibsiz', 'Хуш келибсиз'],
      ['Stantsiya', 'Станция'],
      ['tugatsangiz', 'тугатсангиз'],
      ["Yo'lning yarmi", 'Йўлнинг ярми'],
      ['Quyosh paneli', 'Қуёш панели'],
      ['U har navbatda', 'У ҳар навбатда'],
      ["SHAMOL", 'ШАМОЛ'],
      ['(eman)', '(эман)'],
    ];
    for (const [latin, cyrillic] of pairs) expect(uzLatinToCyrillic(latin), latin).toBe(cyrillic);
  });

  it('leaves placeholders, key names and the brand untouched', () => {
    expect(uzLatinToCyrillic('{turns} navbatda')).toBe('{turns} навбатда');
    expect(uzLatinToCyrillic('Terra Revival')).toBe('Terra Revival');
    expect(uzLatinToCyrillic('Terra qayta tirildi')).toBe('Terra қайта тирилди');
    expect(uzLatinToCyrillic('Enter – bajarish · E – navbatni tugatish · Z – bekor qilish')).toBe('Enter – бажариш · E – навбатни тугатиш · Z – бекор қилиш');
    expect(uzLatinToCyrillic('Dunyo kodi (seed)')).toBe('Дунё коди (seed)');
    expect(uzLatinToCyrillic('Ўзбекча 100%')).toBe('Ўзбекча 100%');
  });

  it('leaves no Latin letters or apostrophes in any Uzbek string outside protected spans', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const out = uzLatinToCyrillic(uz[key]);
      const rest = out.replace(new RegExp(PROTECTED.source, 'g'), '');
      expect(/[A-Za-z'‘’ʻ]/.test(rest), `${key}: ${out}`).toBe(false);
    }
  });
});
