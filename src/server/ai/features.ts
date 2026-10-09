import { z } from 'zod';
import { categoryAncestry } from '../../shared/taxonomy';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { getAdapter } from '../marketplaces/registry';
import { getListing } from '../services/listings';
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
