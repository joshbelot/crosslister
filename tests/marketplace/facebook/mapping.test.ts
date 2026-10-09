import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/shared/constants';
import { CATEGORIES } from '../../../src/shared/taxonomy';
import { facebookAdapter } from '../../../src/server/marketplaces/facebook';
import { FACEBOOK_CONDITIONS, facebookCategoryTerms, termFromPath } from '../../../src/server/marketplaces/facebook/mapping';

describe('facebook mapping', () => {
  it('maps all 6 conditions', () => {
    expect(Object.keys(FACEBOOK_CONDITIONS).sort()).toEqual([...CONDITIONS].sort());
    expect(FACEBOOK_CONDITIONS.like_new[0]).toBe('Used - Like New');
  });
  it('resolves category search terms from the closest mapped ancestor', () => {
    expect(facebookCategoryTerms('men.shoes.sneakers')).toEqual(["Men's Shoes", 'Shoes']);
    expect(facebookCategoryTerms('women.dresses')).toEqual(["Women's Clothing", 'Clothing']);
    expect(facebookCategoryTerms('men.bottoms.jeans')).toEqual(["Men's Clothing", 'Clothing']);
    expect(facebookCategoryTerms('collectibles.trading_cards')).toEqual(['Trading Cards', 'Collectibles']);
    expect(facebookCategoryTerms('other.other')).toEqual(['Miscellaneous']);
    expect(facebookCategoryTerms('nope')).toBeNull();
    for (const c of CATEGORIES.filter((x) => x.selectable && x.id.split('.')[0] !== 'collectibles')) expect(facebookCategoryTerms(c.id), c.id).not.toBeNull();
    expect(termFromPath('Men > Shoes > Sneakers')).toBe('Sneakers');
    expect(termFromPath('  ')).toBeNull();
  });
  it('parses listing URLs', () => {
    expect(facebookAdapter.parseListingUrl('https://www.facebook.com/marketplace/item/1234567890123456/')).toEqual({ remoteId: '1234567890123456', url: 'https://www.facebook.com/marketplace/item/1234567890123456/' });
    expect(facebookAdapter.parseListingUrl('https://facebook.com/marketplace/item/42?ref=x')?.remoteId).toBe('42');
    expect(facebookAdapter.parseListingUrl('https://www.facebook.com/marketplace/you/selling')).toBeNull();
    expect(facebookAdapter.parseListingUrl('https://example.com/marketplace/item/42')).toBeNull();
  });
  it('never allows auto-submit and has no status checks', () => {
    expect(facebookAdapter.capabilities).toMatchObject({ autoSubmitAllowed: false, statusCheck: 'none', maxPhotos: 10, titleMaxLength: 100 });
  });
});
