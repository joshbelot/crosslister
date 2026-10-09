import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/shared/constants';
import { autoAspects, categoryQuery, EBAY_CONDITION_PREFERENCE, hasAutoValue, mergeAspects, pickConditionId } from '../../../src/server/marketplaces/ebay/mapping';
import type { AspectDef } from '../../../src/server/marketplaces/ebay/rest';
import { ebayAdapter } from '../../../src/server/marketplaces/ebay';

const listing = {
  brand: "Levi's", size: '10.5', sizeType: 'shoe_men' as const, colors: ['blue' as const, 'black' as const], categoryId: 'men.shoes.sneakers',
  categoryLabels: ['Men', 'Shoes', 'Sneakers'], department: 'men', material: 'Leather', model: 'Air Max',
};
const asp = (name: string, over: Partial<AspectDef> = {}): AspectDef => ({ name, required: false, mode: 'FREE_TEXT', multi: false, values: [], ...over });

describe('ebay mapping', () => {
  it('has a preference list for every condition', () => {
    expect(Object.keys(EBAY_CONDITION_PREFERENCE).sort()).toEqual([...CONDITIONS].sort());
  });
  it('picks the first allowed preferred condition id', () => {
    expect(pickConditionId('new_with_tags', [1000, 3000])).toBe(1000);
    expect(pickConditionId('new_without_tags', [1000, 3000])).toBe(1000);
    expect(pickConditionId('new_without_tags', [1500, 1000])).toBe(1500);
    expect(pickConditionId('good', [4000, 5000])).toBe(5000);
    expect(pickConditionId('like_new', [1000])).toBeNull();
    expect(pickConditionId('poor', [3000, 7000])).toBe(7000);
  });
  it('builds the category search text', () => {
    expect(categoryQuery({ categoryLabels: ['Men', 'Shoes', 'Sneakers'], department: 'men', title: 't' })).toBe("Men's Sneakers");
    expect(categoryQuery({ categoryLabels: ['Women', 'Dresses'], department: 'women', title: 't' })).toBe("Women's Dresses");
    expect(categoryQuery({ categoryLabels: ['Electronics', 'Cameras'], department: 'electronics', title: 't' })).toBe('Cameras');
    expect(categoryQuery({ categoryLabels: [], department: null, title: 'Cool thing' })).toBe('Cool thing');
  });
  it('fills item specifics, honouring SELECTION_ONLY allowed values', () => {
    const aspects = [
      asp('Brand'), asp('US Shoe Size', { mode: 'SELECTION_ONLY', values: ['9', '10.5', '11'] }), asp('Color', { multi: true }),
      asp('Department', { mode: 'SELECTION_ONLY', values: ['Men', 'Women', 'Unisex'] }), asp('Type', { mode: 'SELECTION_ONLY', values: ['Athletic Shoes', 'Boots'] }),
      asp('Material'), asp('Model'), asp('Size Type'), asp('Unrelated aspect'),
    ];
    expect(autoAspects(listing, aspects)).toEqual({
      Brand: ["Levi's"], 'US Shoe Size': ['10.5'], Color: ['Blue', 'Black'], Department: ['Men'], Material: ['Leather'], Model: ['Air Max'], 'Size Type': ['Regular'],
    });
  });
  it('uses one value for single-value aspects, Unbranded without a brand, and skips unmatched selection values', () => {
    expect(autoAspects({ ...listing, brand: '' }, [asp('Brand')])).toEqual({ Brand: ['Unbranded'] });
    expect(autoAspects(listing, [asp('Color')])).toEqual({ Color: ['Blue'] });
    expect(autoAspects(listing, [asp('Color', { mode: 'SELECTION_ONLY', values: ['Red', 'Green'] })])).toEqual({});
  });
  it('merges with user values winning and drops empty arrays', () => {
    expect(mergeAspects({ Brand: ['A'], Color: ['Blue'] }, { Brand: ['B'], Color: [] })).toEqual({ Brand: ['B'] });
    expect(hasAutoValue(listing, 'brand')).toBe(true);
    expect(hasAutoValue({ ...listing, material: '' }, 'Material')).toBe(false);
    expect(hasAutoValue(listing, 'Fabric Type')).toBe(false);
  });
  it('parses item URLs', () => {
    expect(ebayAdapter.parseListingUrl('https://www.ebay.com/itm/110123456789')).toEqual({ remoteId: '110123456789', url: 'https://www.ebay.com/itm/110123456789' });
    expect(ebayAdapter.parseListingUrl('https://www.ebay.com/itm/Vintage-Jeans/110123456789?hash=x')?.remoteId).toBe('110123456789');
    expect(ebayAdapter.parseListingUrl('https://www.ebay.com/sch/i.html')).toBeNull();
    expect(ebayAdapter.parseListingUrl('https://notebay.example/itm/110123456789')).toBeNull();
  });
});
