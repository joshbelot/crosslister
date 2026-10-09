import { describe, expect, it } from 'vitest';
import { COLOR_IDS } from '../../../src/shared/colors';
import { CONDITIONS } from '../../../src/shared/constants';
import { CATEGORIES } from '../../../src/shared/taxonomy';
import { mercariAdapter } from '../../../src/server/marketplaces/mercari';
import {
  MERCARI_COLORS, MERCARI_CONDITIONS, mercariCategoryPath, mercariShippingWeight,
} from '../../../src/server/marketplaces/mercari/mapping';
import { selectorGroups, sel } from '../../../src/server/marketplaces/mercari/selectors';

describe('mercari mapping', () => {
  it('maps all 6 conditions and all 18 colors', () => {
    expect(Object.keys(MERCARI_CONDITIONS).sort()).toEqual([...CONDITIONS].sort());
    for (const c of CONDITIONS) expect(MERCARI_CONDITIONS[c].length).toBeGreaterThan(0);
    expect(Object.keys(MERCARI_COLORS).sort()).toEqual([...COLOR_IDS].sort());
    expect(COLOR_IDS).toHaveLength(18);
    expect(MERCARI_COLORS.multicolor).toEqual([]);
  });

  it('builds category paths with synonyms, skipping the bottoms group', () => {
    expect(mercariCategoryPath('men.shoes.sneakers')).toEqual([
      'Men', 'Shoes', ['Sneakers', 'Sneakers', 'Athletic'],
    ]);
    expect(mercariCategoryPath('men.bottoms.jeans')).toEqual(['Men', 'Jeans']);
    expect(mercariCategoryPath('women.tops.t_shirts')).toEqual([
      'Women', ['Tops', 'Tops & blouses', 'Tops'], ['T-Shirts', 'T-shirts', 'Tees'],
    ]);
    expect(mercariCategoryPath('women.dresses')).toEqual(['Women', 'Dresses']);
    expect(mercariCategoryPath('other.other')).toEqual(['Other', 'Other']);
    expect(mercariCategoryPath('does.not.exist')).toBeNull();
  });

  it('every selectable category yields a path', () => {
    for (const c of CATEGORIES.filter((x) => x.selectable)) expect(mercariCategoryPath(c.id), c.id).not.toBeNull();
  });

  it('converts package weight', () => {
    expect(mercariShippingWeight(20)).toEqual({ lb: 1, oz: 4 });
    expect(mercariShippingWeight(16)).toEqual({ lb: 1, oz: 0 });
    expect(mercariShippingWeight(5.2)).toEqual({ lb: 0, oz: 6 });
    expect(mercariShippingWeight(0)).toEqual({ lb: 0, oz: 0 });
  });

  it('parses listing URLs', () => {
    expect(mercariAdapter.parseListingUrl('https://www.mercari.com/us/item/m12345678901/')).toEqual({
      remoteId: 'm12345678901', url: 'https://www.mercari.com/us/item/m12345678901/',
    });
    expect(mercariAdapter.parseListingUrl('https://mercari.com/us/item/m1234567?ref=x')?.remoteId).toBe('m1234567');
    expect(mercariAdapter.parseListingUrl('https://www.mercari.com/sell/edit/m12345678901/')).toBeNull();
    expect(mercariAdapter.parseListingUrl('https://www.mercari.com/us/item/abc/')).toBeNull();
    expect(mercariAdapter.parseListingUrl('https://evil.com/us/item/m12345678901/')).toBeNull();
    expect(mercariAdapter.parseListingUrl('nonsense')).toBeNull();
    expect(mercariAdapter.listingUrl('m1')).toBe('https://www.mercari.com/us/item/m1/');
  });

  it('declares selector groups that cover its sell controls', () => {
    expect(selectorGroups.sell).toContain(sel.title);
    expect(selectorGroups.sell).toContain(sel.submit);
    expect(selectorGroups.home).toContain(sel.loggedIn);
    expect(mercariAdapter.capabilities).toMatchObject({ maxPhotos: 12, titleMaxLength: 80, descriptionMaxLength: 1000, autoSubmitAllowed: true });
  });
});
