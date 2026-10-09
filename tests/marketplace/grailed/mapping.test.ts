import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/shared/constants';
import { CATEGORIES } from '../../../src/shared/taxonomy';
import { grailedAdapter } from '../../../src/server/marketplaces/grailed';
import { GRAILED_CONDITIONS, grailedCategoryPath } from '../../../src/server/marketplaces/grailed/mapping';
import { buildEffectiveListing } from '../../../src/server/services/effectiveListing';
import { DEFAULT_SETTINGS } from '../../../src/server/services/settings';
import { rowToListing, rowToMarketplaceListing } from '../../../src/server/services/mappers';

function eff(categoryId: string) {
  const now = new Date().toISOString();
  const row = {
    id: 'l1', sku: 'CL-1', title: 'T', description: 'D', priceCents: 6500, msrpCents: null, costCents: null, currency: 'USD', condition: 'good', conditionNotes: '',
    categoryId, brand: 'Nike', model: '', size: 'M', colors: [], material: '', quantity: 1, measurements: {}, tags: [],
    shipping: { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' }, notes: '', status: 'draft', source: 'created', soldAt: null,
    soldPriceCents: null, soldMarketplaceId: null, saleDetectedMarketplaceId: null, saleDetectedAt: null, archivedAt: null, createdAt: now, updatedAt: now,
  };
  const ml = rowToMarketplaceListing({
    id: 'm', listingId: 'l1', marketplaceId: 'grailed', status: 'not_listed', remoteId: null, url: null, titleOverride: null, descriptionOverride: null,
    priceOverrideCents: null, data: {}, verified: true, lastError: null, lastErrorCode: null, listedAt: null, endedAt: null, lastSyncedAt: null, createdAt: now, updatedAt: now,
  });
  return buildEffectiveListing(rowToListing(row as never), [], ml, grailedAdapter, DEFAULT_SETTINGS);
}

describe('grailed mapping', () => {
  it('maps all 6 conditions', () => {
    expect(Object.keys(GRAILED_CONDITIONS).sort()).toEqual([...CONDITIONS].sort());
  });
  it('builds category paths for menswear and womenswear only', () => {
    expect(grailedCategoryPath('men.tops.t_shirts')).toEqual(['Menswear', 'Tops', 'Short Sleeve T-Shirts']);
    expect(grailedCategoryPath('men.bottoms.jeans')).toEqual(['Menswear', 'Bottoms', 'Denim']);
    expect(grailedCategoryPath('men.shoes.sneakers')).toEqual(['Menswear', 'Footwear', ['Low-Top Sneakers', 'Hi-Top Sneakers']]);
    expect(grailedCategoryPath('women.tops.blouses')).toEqual(['Womenswear', 'Tops']); // stops at category level
    expect(grailedCategoryPath('women.dresses')).toEqual(['Womenswear', 'Dresses']);
    expect(grailedCategoryPath('kids.toys')).toBeNull();
    expect(grailedCategoryPath('home.decor')).toBeNull();
    for (const c of CATEGORIES.filter((x) => x.selectable && ['men', 'women'].includes(x.id.split('.')[0]!))) expect(grailedCategoryPath(c.id), c.id).not.toBeNull();
  });
  it('errors for departments other than men and women', () => {
    expect(grailedAdapter.validate(eff('kids.shoes'))).toEqual([{ field: 'categoryId', severity: 'error', message: 'Grailed only accepts menswear and womenswear.' }]);
    expect(grailedAdapter.validate(eff('men.tops.polos'))).toEqual([]);
  });
  it('parses listing URLs but rejects edit pages', () => {
    expect(grailedAdapter.parseListingUrl('https://www.grailed.com/listings/1234567-vintage-levis-jeans')).toEqual({ remoteId: '1234567', url: 'https://www.grailed.com/listings/1234567' });
    expect(grailedAdapter.parseListingUrl('https://www.grailed.com/listings/1234567')?.remoteId).toBe('1234567');
    expect(grailedAdapter.parseListingUrl('https://www.grailed.com/listings/1234567/edit')).toBeNull();
    expect(grailedAdapter.parseListingUrl('https://www.grailed.com/listings/1234567-slug/edit')).toBeNull();
    expect(grailedAdapter.parseListingUrl('https://www.grailed.com/sell/new')).toBeNull();
    expect(grailedAdapter.parseListingUrl('https://other.com/listings/1234567')).toBeNull();
  });
  it('has the specified limits', () => {
    expect(grailedAdapter.capabilities).toMatchObject({ maxPhotos: 8, titleMaxLength: 60, descriptionMaxLength: 1000 });
    expect(grailedAdapter.capabilities.requires).toEqual(expect.arrayContaining(['brand', 'size', 'description']));
  });
});
