/**
 * Uzbek Latin → Cyrillic transliteration (R-12.4, design §7.8).
 *
 * The Cyrillic dictionary is derived from the Latin one at start-up, so the two scripts
 * can never drift apart. Rules are applied left to right, longest match first:
 * o'/g' → ў/ғ, sh/ch → ш/ч, yo/yu/ya/ye → ё/ю/я/е (but yo' → йў), "tsiya" → "ция",
 * word-initial e → э, then single letters; a remaining apostrophe between letters is the
 * tutuq belgisi → ъ. Protected spans are copied unchanged.
 */

/** Apostrophe glyphs used for o‘, g‘ and the tutuq belgisi. */
const APOSTROPHES = "'‘’ʻ";

/** Copied as they are: placeholders, the brand, key names in the controls hint, "seed". */
export const PROTECTED = /\{\w+\}|Terra Revival|Terra|Enter|Esc|\bseed\b|\b[A-Z](?= [–-])/;

const SINGLE: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'с',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'ҳ',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'қ',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'х',
  y: 'й',
  z: 'з',
};

const isApostrophe = (c: string | undefined): boolean => c !== undefined && APOSTROPHES.includes(c);
const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z\u0400-\u04FF]/.test(c);
const isUpper = (c: string): boolean => c !== c.toLowerCase();

/** Case of the Latin source carried over: "Sh" → "Ш", "SHA" → "ША", "Tsiya" → "Ция". */
function cased(source: string, cyrillic: string): string {
  if (!isUpper(source[0]!)) return cyrillic;
  const allUpper = source.length > 1 && [...source].every((ch) => !isLetter(ch) || isUpper(ch));
  return allUpper || cyrillic.length === 1 ? cyrillic.toUpperCase() : cyrillic[0]!.toUpperCase() + cyrillic.slice(1);
}

export function uzLatinToCyrillic(text: string): string {
  const guard = new RegExp(PROTECTED.source, 'y');
  let out = '';
  let i = 0;
  while (i < text.length) {
    guard.lastIndex = i;
    const kept = guard.exec(text);
    if (kept) {
      out += kept[0];
      i += kept[0].length;
      continue;
    }
    const c = text[i]!;
    const lower = c.toLowerCase();
    const next = text[i + 1];
    const nextLower = next?.toLowerCase();
    const take = (length: number, cyrillic: string) => {
      out += cased(text.slice(i, i + length), cyrillic);
      i += length;
    };
    if ((lower === 'o' || lower === 'g') && isApostrophe(next)) take(2, lower === 'o' ? 'ў' : 'ғ');
    else if (lower === 's' && nextLower === 'h') take(2, 'ш');
    else if (lower === 'c' && nextLower === 'h') take(2, 'ч');
    else if (lower === 'y' && nextLower === 'o' && !isApostrophe(text[i + 2])) take(2, 'ё');
    else if (lower === 'y' && nextLower === 'u') take(2, 'ю');
    else if (lower === 'y' && nextLower === 'a') take(2, 'я');
    else if (lower === 'y' && nextLower === 'e') take(2, 'е');
    else if (text.slice(i, i + 5).toLowerCase() === 'tsiya') take(5, 'ция');
    else if (lower === 'e' && !isLetter(text[i - 1]) && !isApostrophe(text[i - 1])) take(1, 'э');
    else if (SINGLE[lower]) take(1, SINGLE[lower]);
    else if (isApostrophe(c) && isLetter(text[i - 1]) && isLetter(next)) take(1, 'ъ');
    else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A whole dictionary transliterated, key by key. */
export function cyrillicDictionary<K extends string>(latin: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(latin) as K[]) out[key] = uzLatinToCyrillic(latin[key]);
  return out;
}
