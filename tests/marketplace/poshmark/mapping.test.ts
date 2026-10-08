import { describe, expect, it } from 'vitest';
import { COLOR_IDS } from '../../../src/shared/colors';
import { CONDITIONS } from '../../../src/shared/constants';
import { CATEGORIES } from '../../../src/shared/taxonomy';
import { poshmarkAdapter } from '../../../src/server/marketplaces/poshmark';
import { POSHMARK_COLORS, POSHMARK_CONDITIONS, poshmarkCategoryPath, poshmarkWholeDollars } from '../../../src/server/marketplaces/poshmark/mapping';
import { buildEffectiveListing } from '../../../src/server/services/effectiveListing';
import { DEFAULT_SETTINGS } from '../../../src/server/services/settings';
import { rowToListing, rowToMarketplaceListing } from '../../../src/server/services/mappers';

function eff(over: Record<string, unknown> = {}, mlData: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const row = {
    id: 'l1', sku: 'CL-1', title: 'T', description: 'D', priceCents: 6500, msrpCents: 12000, costCents: null, currency: 'USD', condition: 'good',
    conditionNotes: '', categoryId: 'women.tops.t_shirts', brand: 'Nike', model: '', size: 'M', colors: ['blue'], material: '', quantity: 1,
    measurements: {}, tags: ['a', 'b', 'c', 'd'], shipping: { weightOz: 16, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' },
    notes: '', status: 'draft', source: 'created', soldAt: null, soldPriceCents: null, soldMarketplaceId: null, saleDetectedMarketplaceId: null,
    saleDetectedAt: null, archivedAt: null, createdAt: now, updatedAt: now, ...over,
  };
  const ml = rowToMarketplaceListing({
    id: 'm', listingId: 'l1', marketplaceId: 'poshmark', status: 'not_listed', remoteId: null, url: null, titleOverride: null, descriptionOverride: null,
    priceOverrideCents: null, data: mlData, verified: true, lastError: null, lastErrorCode: null, listedAt: null, endedAt: null, lastSyncedAt: null,
    createdAt: now, updatedAt: now,
  });
  return buildEffectiveListing(rowToListing(row as never), [], ml, poshmarkAdapter, DEFAULT_SETTINGS) as unknown as Parameters<typeof poshmarkAdapter.validate>[0];
}

describe('poshmark mapping', () => {
  it('covers all conditions and colors', () => {
    expect(Object.keys(POSHMARK_CONDITIONS).sort()).toEqual([...CONDITIONS].sort());
    expect(Object.keys(POSHMARK_COLORS).sort()).toEqual([...COLOR_IDS].sort());
  });
  it('builds category paths', () => {
    expect(poshmarkCategoryPath('women.tops.t_shirts')).toEqual(['Women', 'Tops', ['Tees - Short Sleeve', 'Tees']]);
    expect(poshmarkCategoryPath('men.bottoms.jeans')).toEqual(['Men', 'Jeans']);
    expect(poshmarkCategoryPath('women.shoes.sneakers')).toEqual(['Women', 'Shoes', 'Sneakers']);
    expect(poshmarkCategoryPath('women.shoes.boots')).toEqual(['Women', 'Shoes', ['Boots', 'Ankle Boots & Booties', 'Boots']]);
    expect(poshmarkCategoryPath('women.dresses')).toEqual(['Women', 'Dresses']);
    expect(poshmarkCategoryPath('women.outerwear.coats')).toEqual(['Women', 'Jackets & Coats']);
    expect(poshmarkCategoryPath('collectibles.trading_cards')).toBeNull();
    expect(poshmarkCategoryPath('other.other')).toBeNull();
    expect(poshmarkCategoryPath('nope')).toBeNull();
    for (const c of CATEGORIES.filter((x) => x.selectable && !['collectibles', 'other'].includes(x.id.split('.')[0]!))) {
      expect(poshmarkCategoryPath(c.id), c.id).not.toBeNull();
    }
  });
  it('parses listing URLs', () => {
    const id = '0123456789abcdef01234567';
    expect(poshmarkAdapter.parseListingUrl(`https://poshmark.com/listing/vintage-levis-jeans-${id}`)).toEqual({ remoteId: id, url: `https://poshmark.com/listing/vintage-levis-jeans-${id}` });
    expect(poshmarkAdapter.parseListingUrl(`https://poshmark.com/listing/${id}`)?.remoteId).toBe(id);
    expect(poshmarkAdapter.parseListingUrl('https://poshmark.com/listing/too-short-123')).toBeNull();
    expect(poshmarkAdapter.parseListingUrl(`https://poshmark.com/edit-listing/${id}`)).toBeNull();
    expect(poshmarkAdapter.parseListingUrl(`https://other.com/listing/x-${id}`)).toBeNull();
  });
  it('rounds to whole dollars and warns about cents', () => {
    expect(poshmarkWholeDollars(6550)).toBe(66);
    expect(poshmarkWholeDollars(6549)).toBe(65);
    const issues = poshmarkAdapter.validate(eff({ priceCents: 6550 }));
    expect(issues.find((i) => i.field === 'priceCents')?.message).toBe('Poshmark uses whole-dollar prices; $65.50 will be listed as $66.');
    expect(poshmarkAdapter.validate(eff()).some((i) => i.field === 'priceCents')).toBe(false);
  });
  it('errors for unsupported departments', () => {
    const issues = poshmarkAdapter.validate(eff({ categoryId: 'collectibles.trading_cards' }));
    expect(issues).toContainEqual({ field: 'categoryId', severity: 'error', message: "Poshmark doesn't have a category for this item." });
  });
  it('style tags: data wins, else first 3 listing tags', () => {
    expect(poshmarkAdapter.describeMapping(eff()).find((r) => r.label === 'Style tags')?.value).toBe('a, b, c');
    expect(poshmarkAdapter.describeMapping(eff({}, { styleTags: ['x'] })).find((r) => r.label === 'Style tags')?.value).toBe('x');
  });
  it('requires MSRP, size and a category (capabilities)', () => {
    expect(poshmarkAdapter.capabilities.requires).toEqual(expect.arrayContaining(['msrp', 'size', 'category']));
    expect(poshmarkAdapter.capabilities).toMatchObject({ maxPhotos: 16, titleMaxLength: 80, descriptionMaxLength: 1500, minPriceCents: 300 });
  });
});
