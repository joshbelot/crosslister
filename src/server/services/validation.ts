import { eq } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import type {
  Listing, MarketplaceListing, MarketplaceValidation, ValidationIssue, ValidationReport,
} from '../../shared/types';
import type { Db } from '../db/client';
import { listings, marketplaceListings, photos } from '../db/schema';
import { notFound } from '../errors';
import { categoryPathFor } from '../marketplaces/common';
import { getAdapter } from '../marketplaces/registry';
import type { EffectiveListing, MarketplaceAdapter } from '../marketplaces/types';
import { buildEffectiveListing } from './effectiveListing';
import { rowToListing, rowToMarketplaceListing } from './mappers';
import { getSettings } from './settings';

/** Rules that apply to every marketplace (05 §4.1). */
export function validateCanonical(listing: Listing, photoCount: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, severity: 'error', message });
  const warn = (field: string, message: string) => issues.push({ field, severity: 'warning', message });
  if (!listing.title.trim()) err('title', 'Add a title.');
  if (photoCount === 0) err('photos', 'Add at least one photo.');
  if (!listing.priceCents) err('priceCents', 'Add a price.');
  if (!listing.condition) err('condition', 'Choose a condition.');
  if (!listing.categoryId) err('categoryId', 'Choose a category.');
  if (!listing.description.trim()) warn('description', 'Add a description — buyers rarely purchase without one.');
  if (listing.quantity > 1) warn('quantity', 'Quantity is only sent to eBay; other marketplaces list one item.');
  return issues;
}

/**
 * Common marketplace rules (05 §4.2) followed by the adapter's own checks.
 * `totalPhotoCount` is the number of photos on the listing before slicing to the marketplace's limit.
 */
export function validateForMarketplace(
  eff: EffectiveListing, adapter: MarketplaceAdapter, canonicalTitle: string, totalPhotoCount = eff.photos.length,
): ValidationIssue[] {
  const cap = adapter.capabilities;
  const N = adapter.name;
  const issues: ValidationIssue[] = [];
  const add = (field: string, severity: 'error' | 'warning', message: string) => issues.push({ field, severity, message });

  if (cap.titleMaxLength !== null && (eff.titleTruncated || canonicalTitle.length > cap.titleMaxLength)) {
    add('title', 'warning', `Title will be shortened to ${cap.titleMaxLength} characters on ${N}: "${eff.title}"`);
  }
  if (eff.description.length > cap.descriptionMaxLength) {
    add('description', 'error', `Description is ${eff.description.length} characters; ${N} allows ${cap.descriptionMaxLength}. Shorten it or write a ${N}-specific description.`);
  }
  if (eff.priceCents !== null && eff.priceCents < cap.minPriceCents) {
    add('priceCents', 'error', `${N} requires a price of at least ${formatCents(cap.minPriceCents)}.`);
  }
  if (cap.maxPriceCents !== null && eff.priceCents !== null && eff.priceCents > cap.maxPriceCents) {
    add('priceCents', 'error', `${N} allows a price of at most ${formatCents(cap.maxPriceCents)}.`);
  }
  if (cap.requires.includes('brand') && !eff.brand.trim()) add('brand', 'error', `${N} requires a brand.`);
  if (cap.requires.includes('size') && eff.sizeType !== 'none' && !eff.size.trim()) add('size', 'error', `${N} requires a size.`);
  if (cap.requires.includes('shippingWeight') && eff.shipping.weightOz === null) {
    add('shipping.weightOz', 'error', `${N} needs the package weight (Shipping → Weight).`);
  }
  if (cap.requires.includes('msrp') && eff.msrpCents === null) add('msrpCents', 'error', `${N} requires the original retail price (MSRP).`);
  if (cap.requires.includes('colors') && eff.colors.length === 0) add('colors', 'error', `${N} requires a color.`);
  if (cap.requires.includes('description') && !eff.description.trim()) {
    add('description', 'error', `${N} requires a description.`);
  }
  if (totalPhotoCount > cap.maxPhotos) add('photos', 'warning', `Only the first ${cap.maxPhotos} photos will be uploaded to ${N}.`);
  for (const e of eff.dataErrors) add('data', 'error', `${N} settings: ${e}`);
  if (adapter.kind === 'browser' && adapter.categoryPath && eff.categoryId && !categoryPathFor(adapter, eff)) {
    add('categoryId', 'warning', `Category isn't mapped for ${N} — you'll choose it in the browser.`);
  }

  return [...issues, ...adapter.validate(eff)];
}

function syntheticTarget(listingId: string, marketplaceId: MarketplaceId): MarketplaceListing {
  const now = new Date().toISOString();
  return {
    id: '', listingId, marketplaceId, status: 'not_listed', remoteId: null, url: null, titleOverride: null,
    descriptionOverride: null, priceOverrideCents: null, data: {}, verified: true, lastError: null, lastErrorCode: null,
    listedAt: null, endedAt: null, lastSyncedAt: null, createdAt: now, updatedAt: now,
  };
}

export function buildValidationReport(db: Db, listingId: string, marketplaceIds?: MarketplaceId[]): ValidationReport {
  const row = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!row) throw notFound('Listing');
  const listing = rowToListing(row);
  const photoRows = db.select().from(photos).where(eq(photos.listingId, listingId)).all();
  const mls = db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, listingId)).all().map(rowToMarketplaceListing);
  const ids = (marketplaceIds ?? mls.map((m) => m.marketplaceId))
    .slice().sort((a, b) => MARKETPLACE_ORDER.indexOf(a) - MARKETPLACE_ORDER.indexOf(b));
  const settings = getSettings(db);
  const canonical = validateCanonical(listing, photoRows.length);
  const canonicalErrors = canonical.filter((i) => i.severity === 'error');

  const marketplaces: MarketplaceValidation[] = ids.map((mp) => {
    const adapter = getAdapter(mp);
    const ml = mls.find((m) => m.marketplaceId === mp) ?? syntheticTarget(listingId, mp);
    const eff = buildEffectiveListing(listing, photoRows, ml, adapter, settings);
    const issues = [
      ...canonicalErrors,
      ...validateForMarketplace(eff, adapter, (ml.titleOverride ?? listing.title).trim(), photoRows.length),
    ];
    return {
      marketplaceId: mp,
      ready: issues.every((i) => i.severity !== 'error'),
      issues,
      preview: { title: eff.title, priceCents: eff.priceCents, photoCount: eff.photos.length },
    };
  });
  return { canonical, marketplaces };
}
