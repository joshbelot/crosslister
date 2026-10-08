import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, categoryAncestry, categoryPathLabel, departmentOf, getCategory, isSelectableCategory,
  lookupByCategory, sizeTypeOf,
} from '../../src/shared/taxonomy';

describe('taxonomy', () => {
  it('every leaf is selectable and has an existing parent', () => {
    for (const c of CATEGORIES) {
      if (c.parentId) expect(getCategory(c.parentId), c.id).toBeDefined();
      if (c.selectable) expect(isSelectableCategory(c.id)).toBe(true);
    }
    expect(isSelectableCategory('women')).toBe(false);
    expect(isSelectableCategory('women.tops')).toBe(false);
    expect(isSelectableCategory('nope')).toBe(false);
  });
  it('ids are unique', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });
  it('builds ancestry and labels', () => {
    expect(categoryAncestry('women.shoes.sneakers').map((c) => c.id)).toEqual(['women', 'women.shoes', 'women.shoes.sneakers']);
    expect(categoryPathLabel('women.shoes.sneakers')).toBe('Women › Shoes › Sneakers');
    expect(departmentOf('men.tops.polos')).toBe('men');
  });
  it('inherits size types', () => {
    expect(sizeTypeOf('men.shoes.sneakers')).toBe('shoe_men');
    expect(sizeTypeOf('women.bottoms.jeans')).toBe('waist');
    expect(sizeTypeOf('women.bottoms.pants')).toBe('letter');
    expect(sizeTypeOf('men.bottoms.pants')).toBe('waist');
    expect(sizeTypeOf('home.decor')).toBe('none');
    expect(sizeTypeOf('unknown.x')).toBe('none');
    expect(sizeTypeOf(null)).toBe('none');
  });
  it('lookupByCategory falls back to ancestors', () => {
    const map = { 'women.shoes': 'S', 'women.shoes.boots': 'B' };
    expect(lookupByCategory(map, 'women.shoes.boots')).toBe('B');
    expect(lookupByCategory(map, 'women.shoes.heels')).toBe('S');
    expect(lookupByCategory(map, 'men.tops.polos')).toBeUndefined();
  });
});
