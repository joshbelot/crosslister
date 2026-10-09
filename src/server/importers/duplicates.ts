import { and, asc, eq, isNull } from 'drizzle-orm';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ListingPatch } from '../../shared/schemas';
import { jaccard, normalizeText, tokenSet } from '../../shared/text';
import type { Db } from '../db/client';
import { listings, marketplaceListings, photos } from '../db/schema';
import { hammingDistance } from '../services/imageProcessing';
import { hashFirstPhotos } from './hash';

export interface DuplicateMatch { listingId: string; score: number; reasons: string[] }

export const duplicateLabel = (score: number) => (score >= 0.7 ? 'Likely duplicate' : 'Possible duplicate');

/** Suggest existing listings that look like the item being imported. Never merges anything by itself (07 §6). */
export async function findDuplicates(
  db: Db, q: { draft: ListingPatch; photoPaths: string[]; marketplaceId: MarketplaceId; remoteId: string | null },
): Promise<DuplicateMatch[]> {
  if (q.remoteId) {
    const linked = db.select().from(marketplaceListings)
      .where(and(eq(marketplaceListings.marketplaceId, q.marketplaceId), eq(marketplaceListings.remoteId, q.remoteId))).get();
    if (linked) return [{ listingId: linked.listingId, score: 1, reasons: [`Same ${MARKETPLACE_NAMES[q.marketplaceId]} listing ID`] }];
  }

  const importHashes = await hashFirstPhotos(q.photoPaths, 3);
  const candidates = db.select().from(listings).where(isNull(listings.archivedAt)).all();
  const photoRows = db.select().from(photos).orderBy(asc(photos.position)).all();
  const draftTokens = tokenSet(q.draft.title ?? '');
  const out: DuplicateMatch[] = [];

  for (const c of candidates) {
    let score = 0;
    const reasons: string[] = [];
    const hashes = photoRows.filter((p) => p.listingId === c.id).slice(0, 6).map((p) => p.dhash).filter((h): h is string => Boolean(h));
    let d = Infinity;
    for (const a of importHashes) for (const b of hashes) d = Math.min(d, hammingDistance(a, b));
    if (d <= 6) { score += 0.5; reasons.push('Very similar photo'); }
    else if (d <= 12) { score += 0.3; reasons.push('Similar photo'); }

    const j = jaccard(draftTokens, tokenSet(c.title));
    score += 0.25 * j;
    if (j >= 0.6) reasons.push('Similar title');

    const brandA = normalizeText(q.draft.brand ?? '');
    const brandB = normalizeText(c.brand);
    if (brandA && brandB) {
      if (brandA === brandB) { score += 0.1; reasons.push('Same brand'); } else score -= 0.2;
    }
    const sizeA = normalizeText(q.draft.size ?? '');
    const sizeB = normalizeText(c.size);
    if (sizeA && sizeB) {
      if (sizeA === sizeB) { score += 0.1; reasons.push('Same size'); } else score -= 0.2;
    }
    const pa = q.draft.priceCents;
    const pb = c.priceCents;
    if (pa && pb && Math.abs(pa - pb) / Math.max(pa, pb) <= 0.2) { score += 0.05; reasons.push('Similar price'); }

    score = Math.max(0, Math.min(1, score));
    if (score >= 0.45) out.push({ listingId: c.id, score: Math.round(score * 100) / 100, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}
