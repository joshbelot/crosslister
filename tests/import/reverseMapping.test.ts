import { describe, expect, it } from 'vitest';
import { reverseCategory, reverseColors, reverseCondition } from '../../src/server/importers/reverseMapping';

describe('reverseCondition', () => {
  it('maps eBay condition IDs', () => {
    const ids: Record<string, string> = { '1000': 'new_with_tags', '1500': 'new_without_tags', '2990': 'like_new', '3000': 'good', '6000': 'fair', '7000': 'poor', '9999': 'good' };
    for (const [id, want] of Object.entries(ids)) expect(reverseCondition('ebay', id)).toBe(want);
  });
  it('maps marketplace labels and schema.org words', () => {
    expect(reverseCondition('mercari', 'Like new')).toBe('new_without_tags'); // first key wins (07 §7)
    expect(reverseCondition('mercari', 'Good')).toBe('good');
    expect(reverseCondition('poshmark', 'NWT')).toBe('new_with_tags');
    expect(reverseCondition('other', 'Used')).toBe('good');
    expect(reverseCondition('other', 'Refurbished')).toBe('like_new');
    expect(reverseCondition('other', 'Damaged')).toBe('poor');
    expect(reverseCondition('other', 'New')).toBe('new_without_tags');
    expect(reverseCondition('other', 'New', 'Brand new, tags attached')).toBe('new_with_tags');
    expect(reverseCondition('other', null)).toBeNull();
    expect(reverseCondition('other', 'mystery')).toBeNull();
  });
});

describe('reverseCategory', () => {
  it('uses breadcrumbs, title and the department hint', () => {
    expect(reverseCategory(['Men', 'Bottoms', 'Jeans'], 'Levi 501')).toBe('men.bottoms.jeans');
    expect(reverseCategory(['Women', 'Dresses'], 'Floral dress')?.startsWith('women.')).toBe(true);
  });
  it('returns null when nothing matches', () => {
    expect(reverseCategory(['Widgets'], 'Thing')).toBeNull();
  });
});

describe('reverseColors', () => {
  it('maps labels and synonyms, unique, max 2', () => {
    expect(reverseColors(['Blue'])).toEqual(['blue']);
    expect(reverseColors(['Grey', 'gray', 'Burgundy'])).toEqual(['gray', 'red']);
    expect(reverseColors(['Black', 'White', 'Red'])).toHaveLength(2);
    expect(reverseColors([])).toEqual([]);
  });
});
