import { describe, expect, it } from 'vitest';
import { COLOR_IDS } from '../../../src/shared/colors';
import { CONDITIONS } from '../../../src/shared/constants';
import { CATEGORIES } from '../../../src/shared/taxonomy';
import { depopAdapter } from '../../../src/server/marketplaces/depop';
import { DEPOP_COLORS, DEPOP_CONDITIONS, depopCategoryPath, depopHashtagLine, depopParcelSize } from '../../../src/server/marketplaces/depop/mapping';
import { buildEffectiveListing } from '../../../src/server/services/effectiveListing';
import { DEFAULT_SETTINGS } from '../../../src/server/services/settings';
import { rowToListing, rowToMarketplaceListing } from '../../../src/server/services/mappers';

function eff(over: Record<string, unknown> = {}, mlData: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const row = {
    id: 'l1', sku: 'CL-1', title: 'Vintage Levi 501', description: 'Great jeans.', priceCents: 6500, msrpCents: null, costCents: null, currency: 'USD',
    condition: 'good', conditionNotes: '', categoryId: 'men.bottoms.jeans', brand: "Levi's", model: '', size: '32', colors: ['blue'], material: '',
    quantity: 1, measurements: {}, tags: ['Vintage', 'Levi\'s 501', 'y2k!!', 'denim', 'blue jeans', 'extra'],
    shipping: { weightOz: 16, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' }, notes: '', status: 'draft', source: 'created',
    soldAt: null, soldPriceCents: null, soldMarketplaceId: null, saleDetectedMarketplaceId: null, saleDetectedAt: null, archivedAt: null,
    createdAt: now, updatedAt: now, ...over,
  };
  const ml = rowToMarketplaceListing({
    id: 'm', listingId: 'l1', marketplaceId: 'depop', status: 'not_listed', remoteId: null, url: null, titleOverride: null, descriptionOverride: null,
    priceOverrideCents: null, data: mlData, verified: true, lastError: null, lastErrorCode: null, listedAt: null, endedAt: null, lastSyncedAt: null,
    createdAt: now, updatedAt: now,
  });
  return buildEffectiveListing(rowToListing(row as never), [], ml, depopAdapter, DEFAULT_SETTINGS);
}

describe('depop mapping', () => {
  it('covers all conditions and colors', () => {
    expect(Object.keys(DEPOP_CONDITIONS).sort()).toEqual([...CONDITIONS].sort());
    expect(Object.keys(DEPOP_COLORS).sort()).toEqual([...COLOR_IDS].sort());
    expect(DEPOP_COLORS.multicolor).toEqual(['Multi']);
  });
  it('builds category paths with department synonyms', () => {
    expect(depopCategoryPath('men.shoes.sneakers')).toEqual([['Men', 'Menswear', 'Men'], ['Shoes', 'Footwear', 'Shoes'], ['Sneakers', 'Trainers', 'Sneakers']]);
    expect(depopCategoryPath('women.bottoms.jeans')).toEqual([['Women', 'Womenswear', 'Women'], 'Bottoms', 'Jeans']);
    expect(depopCategoryPath('collectibles.trading_cards')).toEqual([['Collectibles & Media', 'Everything else'], 'Trading Cards']);
    expect(depopCategoryPath('nope')).toBeNull();
    for (const c of CATEGORIES.filter((x) => x.selectable)) expect(depopCategoryPath(c.id), c.id).not.toBeNull();
  });
  it('picks a parcel size by weight', () => {
    expect(depopParcelSize(null)).toBeNull();
    expect(depopParcelSize(4)).toEqual(['Extra small', 'XS']);
    expect(depopParcelSize(8)).toEqual(['Small']);
    expect(depopParcelSize(16)).toEqual(['Medium']);
    expect(depopParcelSize(17)).toEqual(['Large']);
    expect(depopParcelSize(49)).toEqual(['Extra large', 'XL']);
  });
  it('rejects create/edit URLs and parses product slugs', () => {
    expect(depopAdapter.parseListingUrl('https://www.depop.com/products/jdoe-vintage-levis-1a2b/')).toEqual({ remoteId: 'jdoe-vintage-levis-1a2b', url: 'https://www.depop.com/products/jdoe-vintage-levis-1a2b/' });
    expect(depopAdapter.parseListingUrl('https://www.depop.com/products/create/')).toBeNull();
    expect(depopAdapter.parseListingUrl('https://www.depop.com/products/edit/abc/')).toBeNull();
    expect(depopAdapter.parseListingUrl('https://www.depop.com/jdoe/')).toBeNull();
    expect(depopAdapter.parseListingUrl('https://example.com/products/abc-def/')).toBeNull();
  });
  it('finalizeDescription prepends the title and appends hashtags', () => {
    expect(depopHashtagLine([], ['Vintage', "Levi's 501", 'y2k!!', 'denim', 'blue jeans', 'extra'])).toBe('#vintage #levis501 #y2k #denim #bluejeans');
    const e = eff();
    expect(e.description).toBe('Vintage Levi 501\n\nGreat jeans.\n\n#vintage #levis501 #y2k #denim #bluejeans');
    expect(eff({}, { hashtags: ['Retro', 'Denim'] }).description.endsWith('#retro #denim')).toBe(true);
    expect(eff({ tags: [] }).description).toBe('Vintage Levi 501\n\nGreat jeans.');
  });
  it('has no title limit but a 1000 character description limit', () => {
    expect(depopAdapter.capabilities).toMatchObject({ titleMaxLength: null, descriptionMaxLength: 1000, maxPhotos: 8 });
    expect(depopAdapter.photoSpec.maxLongEdge).toBe(1600);
  });
});
