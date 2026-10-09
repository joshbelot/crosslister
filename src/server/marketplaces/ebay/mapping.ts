import type { Condition } from '../../../shared/constants';
import { sizeSynonyms } from '../../../shared/sizes';
import { COLORS } from '../../../shared/colors';
import { bestMatch } from '../../browser/match';
import type { EffectiveListing } from '../types';
import type { AspectDef } from './rest';

export const EBAY_CONDITION_PREFERENCE: Record<Condition, number[]> = {
  new_with_tags: [1000],
  new_without_tags: [1500, 1000],
  like_new: [2750, 2990, 4000, 3000],
  good: [3000, 5000, 4000],
  fair: [3010, 6000, 5000, 3000],
  poor: [7000, 3010, 6000, 3000],
};

/** First preferred condition id that the category allows; null when none fits. */
export function pickConditionId(c: Condition, allowed: number[]): number | null {
  return EBAY_CONDITION_PREFERENCE[c].find((id) => allowed.includes(id)) ?? null;
}

/** Search text for eBay's category suggestion API, e.g. "Men's Sneakers". */
export function categoryQuery(l: Pick<EffectiveListing, 'categoryLabels' | 'department' | 'title'>): string {
  const leaf = l.categoryLabels[l.categoryLabels.length - 1] ?? l.title;
  if (l.department === 'men') return `Men's ${leaf}`;
  if (l.department === 'women') return `Women's ${leaf}`;
  return leaf;
}

type AspectSource = Pick<EffectiveListing, 'brand' | 'size' | 'sizeType' | 'colors' | 'categoryId' | 'categoryLabels' | 'department' | 'material' | 'model'>;

const colorLabel = (id: string) => COLORS.find((c) => c.id === id)?.label ?? id;

function departmentValue(l: AspectSource): string | null {
  if (l.categoryId === 'kids.girls_clothing') return 'Girls';
  if (l.categoryId === 'kids.boys_clothing') return 'Boys';
  if (l.categoryId === 'kids.baby_clothing') return 'Baby';
  if (l.department === 'men') return 'Men';
  if (l.department === 'women') return 'Women';
  return null;
}

/** Candidate values per aspect name, without consulting eBay's allowed values. */
function candidateValues(l: AspectSource, name: string): string[][] {
  switch (name.toLowerCase()) {
    case 'brand': return [[l.brand.trim() || 'Unbranded']];
    case 'size': case 'us shoe size': return l.size.trim() ? [sizeSynonyms(l.size)] : [];
    case 'color': return l.colors.length ? l.colors.map((c) => [colorLabel(c)]) : [];
    case 'department': { const d = departmentValue(l); return d ? [[d]] : []; }
    case 'type': { const leaf = l.categoryLabels[l.categoryLabels.length - 1]; return leaf ? [[leaf]] : []; }
    case 'material': return l.material.trim() ? [[l.material.trim()]] : [];
    case 'model': return l.model.trim() ? [[l.model.trim()]] : [];
    case 'size type': return [['Regular']];
    default: return [];
  }
}

/** Item specifics eBay can be given without asking the user (SELECTION_ONLY values must match an allowed value). */
export function autoAspects(l: AspectSource, aspects: AspectDef[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of aspects) {
    const wanted = candidateValues(l, a.name);
    if (wanted.length === 0) continue;
    const values: string[] = [];
    for (const synonyms of wanted) {
      if (a.mode === 'SELECTION_ONLY') {
        const m = bestMatch(synonyms, a.values, 0.8);
        if (m) values.push(m.option);
      } else {
        values.push(synonyms[0]!);
      }
    }
    if (values.length === 0) continue;
    out[a.name] = a.multi ? [...new Set(values)] : [values[0]!];
  }
  return out;
}

/** Names we could fill automatically from the listing alone (used by validation, no network). */
export function hasAutoValue(l: AspectSource, name: string): boolean {
  return candidateValues(l, name).length > 0;
}

export function mergeAspects(auto: Record<string, string[]>, user: Record<string, string[]>): Record<string, string[]> {
  const merged = { ...auto, ...user };
  for (const k of Object.keys(merged)) if (!merged[k] || merged[k]!.length === 0) delete merged[k];
  return merged;
}

export const EBAY_LISTING_REGEX = /\/itm\/(?:[^/]+\/)?(\d{9,15})/;
export const EBAY_HOSTS = ['ebay.com'];
