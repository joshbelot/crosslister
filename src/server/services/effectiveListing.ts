import type { Listing, MarketplaceListing, Settings } from '../../shared/types';
import { applyPriceAdjust } from '../../shared/money';
import { categoryAncestry, departmentOf, sizeTypeOf } from '../../shared/taxonomy';
import { truncateAtWord } from '../../shared/text';
import type { PhotoRow } from '../db/schema';
import type { EffectiveListing, MarketplaceAdapter } from '../marketplaces/types';

const MEASUREMENT_LABELS: Array<[keyof Listing['measurements'], string]> = [
  ['chestIn', 'Chest'], ['waistIn', 'Waist'], ['hipIn', 'Hip'], ['inseamIn', 'Inseam'], ['riseIn', 'Rise'],
  ['lengthIn', 'Length'], ['shoulderIn', 'Shoulder'], ['sleeveIn', 'Sleeve'],
  ['widthIn', 'Width'], ['heightIn', 'Height'], ['depthIn', 'Depth'],
];

export function measurementsLine(m: Listing['measurements']): string {
  const parts = MEASUREMENT_LABELS.flatMap(([key, label]) => {
    const v = m[key];
    return typeof v === 'number' ? [`${label} ${Number(v)}"`] : [];
  });
  return parts.length ? `Measurements: ${parts.join(' · ')}` : '';
}

export function buildEffectiveListing(
  listing: Listing, photos: PhotoRow[], ml: MarketplaceListing, adapter: MarketplaceAdapter, settings: Settings,
): EffectiveListing {
  const cap = adapter.capabilities;
  const prefs = settings.marketplaces[adapter.id];

  const rawTitle = (ml.titleOverride ?? listing.title).trim();
  const max = cap.titleMaxLength;
  const titleTruncated = max !== null && rawTitle.length > max;
  const title = titleTruncated && max !== null ? truncateAtWord(rawTitle, max) : rawTitle;

  const priceCents = ml.priceOverrideCents ??
    (listing.priceCents === null ? null : applyPriceAdjust(listing.priceCents, prefs?.priceAdjustPercent ?? 0));

  const base = (ml.descriptionOverride ?? listing.description).trim();
  const notes = listing.conditionNotes.trim();
  const parts = [
    base,
    measurementsLine(listing.measurements),
    notes && !base.toLowerCase().includes(notes.toLowerCase()) ? `Flaws/notes: ${notes}` : '',
    settings.descriptionFooter.trim(),
  ].filter(Boolean);

  const parsed = adapter.dataSchema.safeParse(ml.data);
  let data: Record<string, unknown>;
  let dataErrors: string[] = [];
  if (parsed.success) {
    data = parsed.data as Record<string, unknown>;
  } else {
    data = adapter.dataSchema.parse({}) as Record<string, unknown>;
    dataErrors = parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`);
  }

  const ordered = [...photos].sort((a, b) => a.position - b.position).slice(0, cap.maxPhotos);
  const categoryId = listing.categoryId;
  const eff: EffectiveListing = {
    listingId: listing.id, sku: listing.sku, marketplaceId: adapter.id,
    title, titleTruncated, description: parts.join('\n\n'), priceCents, msrpCents: listing.msrpCents,
    condition: listing.condition, conditionNotes: listing.conditionNotes,
    categoryId, categoryLabels: categoryId ? categoryAncestry(categoryId).map((c) => c.label) : [],
    department: categoryId ? departmentOf(categoryId) : null, sizeType: sizeTypeOf(categoryId),
    brand: listing.brand, model: listing.model, size: listing.size, colors: listing.colors, material: listing.material,
    quantity: listing.quantity, measurements: listing.measurements, tags: listing.tags, shipping: listing.shipping,
    photos: ordered, photoPaths: [], data, dataErrors,
  };
  // `notes` and `costCents` are private and never part of the effective listing.
  if (adapter.finalizeDescription) eff.description = adapter.finalizeDescription(eff);
  return eff;
}
