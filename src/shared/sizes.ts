import type { SizeType } from './taxonomy';

export const SIZE_PRESETS: Record<SizeType, string[]> = {
  letter: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  womens_numeric: ['00', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'],
  waist: ['26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '44'],
  shoe_men: ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '14', '15'],
  shoe_women: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
  kids: ['0-3M', '3-6M', '6-12M', '12-18M', '18-24M', '2T', '3T', '4T', '5', '6', '7', '8', '10', '12', '14', '16'],
  one_size: ['One Size'],
  none: [],
};

/** Normalize user input: trim, collapse whitespace, "os"/"one size" → "One Size", letter presets upper-cased. */
export function normalizeSize(input: string, sizeType: SizeType): string {
  const s = input.trim().replace(/\s+/g, ' ');
  if (/^(os|one ?size|o\/s)$/i.test(s)) return 'One Size';
  if (/^xxxl$/i.test(s)) return '3XL';
  if (sizeType === 'letter') {
    const hit = SIZE_PRESETS.letter.find((p) => p.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
  }
  return s;
}

const LETTER_SYNONYMS: Record<string, string[]> = {
  XXS: ['XX-Small'],
  XS: ['X-Small', 'Extra Small'],
  S: ['Small'],
  M: ['Medium'],
  L: ['Large'],
  XL: ['X-Large', 'Extra Large'],
  XXL: ['XX-Large', '2XL'],
  '3XL': ['XXX-Large', 'XXXL'],
  'One Size': ['OS', 'One size', 'O/S'],
};

/** Synonyms used when matching a size against a marketplace's size options. First entry is the size itself. */
export function sizeSynonyms(size: string): string[] {
  const s = size.trim();
  const letter = LETTER_SYNONYMS[s] ?? LETTER_SYNONYMS[s.toUpperCase()];
  if (letter) return [s, ...letter];
  if (/^\d+(\.\d+)?$/.test(s)) {
    const out = [s, `US ${s}`, `${s} US`];
    if (SIZE_PRESETS.waist.includes(s)) out.push(`W${s}`);
    return out;
  }
  return [s];
}
