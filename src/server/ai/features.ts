import { z } from 'zod';
import { MARKETPLACE_NAMES } from '../../shared/constants';
import { COLOR_IDS, MAX_COLORS, type ColorId } from '../../shared/colors';
import { CATEGORIES, categoryAncestry, categoryPathLabel, isSelectableCategory } from '../../shared/taxonomy';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { getAdapter } from '../marketplaces/registry';
import { getListing } from '../services/listings';
import { displayPath } from '../services/imageProcessing';
import { listPhotoRows } from '../services/photos';
import { AppError } from '../errors';
import { getSettings } from '../services/settings';
import { completeJson, getProvider } from './provider';
import { renderItemDetails, SYSTEM_PROMPT } from './prompts';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'to', 'by', 'size', 'color', 'colour', 'men', 'mens', 'women', 'womens',
  'new', 'used', 'vintage', 'size:', 'nwt', 'nwot', 'free', 'shipping',
]);

const words = (s: string): string[] => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** Words a title may use: everything in the item details, its category labels (any level) and common filler words. */
function allowedWords(details: string, categoryId: string | null): Set<string> {
  const set = new Set<string>([...STOP_WORDS, ...words(details)]);
  if (categoryId) {
    for (const node of categoryAncestry(categoryId)) for (const w of words(node.label)) set.add(w);
  }
  return set;
}

export const inventsWords = (title: string, allowed: Set<string>): boolean => words(title).some((w) => !allowed.has(w) && !allowed.has(w.replace(/s$/, '')));

export async function suggestDescription(db: Db, listingId: string): Promise<{ description: string }> {
  const l = getListing(db, listingId);
  const provider = getProvider(getSettings(db));
  const out = await completeJson(provider, {
    system: SYSTEM_PROMPT,
    prompt: `Item details:\n${renderItemDetails(l)}\n\nWrite a clear, friendly listing description of 3–6 short sentences followed by a bullet list of key details. Mention every flaw from the condition notes. Return JSON {"description": string}.`,
    maxTokens: 700,
  }, z.object({ description: z.string().min(1) }));
  return { description: out.description.trim() };
}

/** Smallest title limit among the given marketplaces (default 80). */
export function titleLimitFor(marketplaceIds: MarketplaceId[]): number {
  const limits = marketplaceIds.map((id) => { try { return getAdapter(id).capabilities.titleMaxLength; } catch { return null; } })
    .filter((n): n is number => typeof n === 'number');
  return limits.length ? Math.min(...limits) : 80;
}

export async function suggestTitles(db: Db, listingId: string, marketplaceIds: MarketplaceId[] = []): Promise<{ titles: string[]; maxLen: number }> {
  const l = getListing(db, listingId);
  const provider = getProvider(getSettings(db));
  const maxLen = titleLimitFor(marketplaceIds);
  const details = renderItemDetails(l);
  const out = await completeJson(provider, {
    system: SYSTEM_PROMPT,
    prompt: `Item details:\n${details}\n\nSuggest 3 search-friendly titles of at most ${maxLen} characters (brand, item type, key attributes like size and color, in that order). Return JSON {"titles": string[]}.`,
    maxTokens: 300,
  }, z.object({ titles: z.array(z.string()).max(10) }));
  const allowed = allowedWords(`${details}\n${l.title}`, l.categoryId);
  const titles = [...new Set(out.titles.map((t) => t.trim()).filter(Boolean))]
    .filter((t) => t.length <= maxLen && !inventsWords(t, allowed)).slice(0, 3);
  return { titles, maxLen };
}

// ---------------------------------------------------------------------------------------------
// Attributes from photos (09 §4.3)
// ---------------------------------------------------------------------------------------------

export interface AttributeSuggestion {
  brand: string | null; categoryId: string | null; colors: ColorId[]; size: string | null; itemType: string | null;
  evidence: { brand?: string; size?: string };
}

const attributeSchema = z.object({
  brand: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  colors: z.array(z.string()).optional(),
  size: z.string().nullable().optional(),
  itemType: z.string().nullable().optional(),
  evidence: z.object({ brand: z.string().optional(), size: z.string().optional() }).partial().optional(),
});

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** Server-side validation of the model's answer: only selectable categories, known colors (max 2), brand/size only with evidence. */
export function validateAttributes(raw: z.infer<typeof attributeSchema>): AttributeSuggestion {
  const evidence = { ...(clean(raw.evidence?.brand) ? { brand: clean(raw.evidence?.brand)! } : {}), ...(clean(raw.evidence?.size) ? { size: clean(raw.evidence?.size)! } : {}) };
  const colors = [...new Set((raw.colors ?? []).map((c) => c.toLowerCase().trim()).filter((c): c is ColorId => (COLOR_IDS as string[]).includes(c)))].slice(0, MAX_COLORS);
  return {
    brand: evidence.brand ? clean(raw.brand) : null,
    categoryId: raw.categoryId && isSelectableCategory(raw.categoryId) ? raw.categoryId : null,
    colors,
    size: evidence.size ? clean(raw.size) : null,
    itemType: clean(raw.itemType),
    evidence,
  };
}

export async function suggestAttributes(db: Db, listingId: string): Promise<AttributeSuggestion> {
  const l = getListing(db, listingId);
  const photos = listPhotoRows(db, listingId).slice(0, 4);
  if (photos.length === 0) throw new AppError('VALIDATION', 400, 'Add at least one photo first.');
  const provider = getProvider(getSettings(db));
  const categories = CATEGORIES.filter((c) => c.selectable).map((c) => `${c.id} = ${categoryPathLabel(c.id)}`).join('\n');
  const raw = await completeJson(provider, {
    system: SYSTEM_PROMPT,
    prompt: `Known item details (may be empty):\n${renderItemDetails(l) || '(none)'}\n\nAllowed category ids:\n${categories}\n\nAllowed color ids: ${COLOR_IDS.join(', ')}\n\n`
      + 'Identify only what you can clearly see. Return JSON {"brand": string|null, "categoryId": string|null, "colors": string[], "size": string|null, "itemType": string|null, "evidence": {"brand"?: string, "size"?: string}}. '
      + 'Only report size if it is readable on a tag in a photo. In "evidence" say where you read the brand or size (for example "tag in photo 2").',
    images: photos.map((p) => displayPath(p)),
    maxTokens: 500,
  }, attributeSchema);
  return validateAttributes(raw);
}

// ---------------------------------------------------------------------------------------------
// Marketplace-specific versions (09 §4.4)
// ---------------------------------------------------------------------------------------------

export const MARKETPLACE_STYLES: Record<MarketplaceId, string> = {
  mercari: 'concise, keyword-rich',
  poshmark: 'friendly, fashion-focused',
  depop: 'casual, short lines, up to 5 relevant hashtags at the end',
  facebook: "plain and local, mention pickup or shipping per seller's notes",
  ebay: 'detailed, factual, item-specifics style',
  grailed: 'brand/designer-first, menswear vocabulary',
  vinted: 'neutral', offerup: 'neutral', etsy: 'neutral', other: 'neutral',
};

export interface MarketplaceCopy { marketplaceId: MarketplaceId; title: string | null; description: string }

const copySchema = z.object({ title: z.string().nullable().optional(), description: z.string().min(1) });

export async function suggestMarketplaceCopy(db: Db, listingId: string, marketplaceIds: MarketplaceId[]): Promise<{ items: MarketplaceCopy[] }> {
  const l = getListing(db, listingId);
  const provider = getProvider(getSettings(db));
  const details = renderItemDetails(l);
  const items: MarketplaceCopy[] = [];
  for (const id of [...new Set(marketplaceIds)]) {
    const caps = getAdapter(id).capabilities;
    const titleMax = caps.titleMaxLength;
    const descMax = caps.descriptionMaxLength;
    const out = await completeJson(provider, {
      system: SYSTEM_PROMPT,
      prompt: `Item details:\n${details}\n\nRewrite the title (${titleMax === null ? 'none' : `max ${titleMax} chars`}) and description (max ${descMax} chars) for ${MARKETPLACE_NAMES[id]}. `
        + `Style: ${MARKETPLACE_STYLES[id]}. Keep all facts and flaws. Return JSON {"title": string|null, "description": string}.`,
      maxTokens: 900,
    }, copySchema);
    const title = titleMax === null ? null : (out.title ?? '').trim().slice(0, titleMax) || null;
    let description = out.description.trim();
    if (description.length > descMax) description = description.slice(0, descMax).replace(/\s+\S*$/, '').trim();
    items.push({ marketplaceId: id, title, description });
  }
  return { items };
}
