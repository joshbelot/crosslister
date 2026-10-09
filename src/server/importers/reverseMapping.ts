import { COLORS, MAX_COLORS, type ColorId } from '../../shared/colors';
import { CONDITIONS, CONDITION_LABELS, type Condition, type MarketplaceId } from '../../shared/constants';
import { CATEGORIES, categoryAncestry, departmentOf } from '../../shared/taxonomy';
import { jaccard, tokenSet } from '../../shared/text';
import { bestMatch } from '../browser/match';
import { DEPOP_CATEGORY_SYNONYMS, DEPOP_CONDITIONS } from '../marketplaces/depop/mapping';
import { FACEBOOK_CATEGORY_TERMS, FACEBOOK_CONDITIONS } from '../marketplaces/facebook/mapping';
import { GRAILED_CATEGORY_OVERRIDES, GRAILED_CONDITIONS } from '../marketplaces/grailed/mapping';
import { MERCARI_CATEGORY_SYNONYMS, MERCARI_CONDITIONS } from '../marketplaces/mercari/mapping';
import { POSHMARK_CATEGORY_OVERRIDES, POSHMARK_CATEGORY_SYNONYMS, POSHMARK_CONDITIONS } from '../marketplaces/poshmark/mapping';

const EBAY_CONDITION_IDS: Record<string, Condition> = {
  '1000': 'new_with_tags', '1500': 'new_without_tags', '1750': 'new_without_tags',
  '2750': 'like_new', '2990': 'like_new', '4000': 'like_new', '3000': 'good', '5000': 'good', '3010': 'fair', '6000': 'fair', '7000': 'poor',
};

const TABLES: Partial<Record<MarketplaceId, Record<Condition, string[]>>> = {
  mercari: MERCARI_CONDITIONS, poshmark: POSHMARK_CONDITIONS, depop: DEPOP_CONDITIONS, facebook: FACEBOOK_CONDITIONS, grailed: GRAILED_CONDITIONS,
};

function schemaOrgCondition(text: string): Condition | null {
  const t = text.toLowerCase();
  if (/\bnew\b/.test(t) && !/like new|used/.test(t)) return /tags/.test(t) ? 'new_with_tags' : 'new_without_tags';
  if (/refurbished/.test(t)) return 'like_new';
  if (/damaged/.test(t)) return 'poor';
  if (/\bused\b/.test(t)) return 'good';
  return null;
}

export function reverseCondition(mp: MarketplaceId, text: string | null, description = ''): Condition | null {
  if (!text) return null;
  if (mp === 'ebay') return EBAY_CONDITION_IDS[text.trim()] ?? 'good';
  const table = TABLES[mp];
  if (table) {
    const labels = [...new Set(Object.values(table).flat())];
    const m = bestMatch(text, labels, 0.8);
    if (m) return CONDITIONS.find((c) => table[c].includes(m.option)) ?? null;
  }
  const generic = bestMatch(text, CONDITIONS.map((c) => CONDITION_LABELS[c]), 0.8);
  if (generic) return CONDITIONS.find((c) => CONDITION_LABELS[c] === generic.option) ?? null;
  const so = schemaOrgCondition(text);
  if (so === 'new_without_tags' && /\btags\b/i.test(description) && !/without tags|no tags/i.test(description)) return 'new_with_tags';
  return so;
}

// --- categories -----------------------------------------------------------------------------

const flat = (p: Array<string | string[]>): string[] => p.flat();

/** Words that other marketplaces use for a canonical node (their synonyms, override paths, search terms). */
function synonymWords(id: string): string[] {
  const words: string[] = [];
  for (const map of [MERCARI_CATEGORY_SYNONYMS, POSHMARK_CATEGORY_SYNONYMS, DEPOP_CATEGORY_SYNONYMS, FACEBOOK_CATEGORY_TERMS]) words.push(...(map[id] ?? []));
  for (const map of [POSHMARK_CATEGORY_OVERRIDES, GRAILED_CATEGORY_OVERRIDES]) if (map[id]) words.push(...flat(map[id]!));
  return words;
}

const CANDIDATES = CATEGORIES.filter((c) => c.selectable).map((c) => ({
  id: c.id,
  department: departmentOf(c.id),
  tokens: tokenSet(categoryAncestry(c.id).flatMap((n) => [n.label, ...synonymWords(n.id)]).join(' ')),
}));

export function departmentHint(tokens: Set<string>): string | null {
  if (['men', 'mens', 'man'].some((w) => tokens.has(w))) return 'men';
  if (['women', 'womens', 'woman', 'ladies'].some((w) => tokens.has(w))) return 'women';
  if (['kids', 'boys', 'girls', 'baby', 'toddler'].some((w) => tokens.has(w))) return 'kids';
  return null;
}

export function reverseCategory(categoryTexts: string[], title: string): string | null {
  const T = tokenSet([...categoryTexts, title].join(' '));
  const hint = departmentHint(T);
  let best: { id: string; score: number } | null = null;
  for (const c of CANDIDATES) {
    let score = jaccard(T, c.tokens);
    if (hint) score += c.department === hint ? 0.2 : -0.3;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score >= 0.35 ? best.id : null;
}

// --- colors ---------------------------------------------------------------------------------

const COLOR_SYNONYMS: Array<[string, ColorId]> = [
  ['grey', 'gray'], ['multi', 'multicolor'], ['multicolour', 'multicolor'], ['multicolor', 'multicolor'], ['burgundy', 'red'], ['maroon', 'red'],
  ['khaki', 'green'], ['olive', 'green'], ['ivory', 'cream'], ['off white', 'cream'], ['camel', 'tan'],
];

export function reverseColors(texts: string[]): ColorId[] {
  const out: ColorId[] = [];
  const labels = COLORS.map((c) => c.label);
  for (const text of texts) {
    const syn = COLOR_SYNONYMS.find(([w]) => w === text.trim().toLowerCase());
    let id: ColorId | undefined = syn?.[1];
    if (!id) {
      const m = bestMatch(text, labels, 0.8);
      id = m ? COLORS.find((c) => c.label === m.option)?.id : undefined;
    }
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= MAX_COLORS) break;
  }
  return out;
}
