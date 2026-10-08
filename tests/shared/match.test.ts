import { describe, expect, it } from 'vitest';
import { bestMatch } from '../../src/server/browser/match';

describe('bestMatch', () => {
  const table: Array<[string | string[], string[], string | null]> = [
    ['Like New', ['New', 'Like new', 'Good'], 'Like new'],
    ['Sneakers', ['Sneakers & Athletic', 'Boots', 'Sneakers'], 'Sneakers'],
    ['Sneakers', ['Sneakers & Athletic', 'Boots'], 'Sneakers & Athletic'],
    [['Shoes', 'Footwear'], ['Clothing', 'Footwear'], 'Footwear'],
    ['T-Shirts', ['Tops', 'T Shirts', 'Shirts'], 'T Shirts'],
    ['Large', ['Small', 'Medium', 'Large', 'X-Large'], 'Large'],
    ['Extra Large', ['Small', 'Medium'], null],
    ['Gucci', ['Nike', 'Adidas'], null],
    ['Blue', ['Light Blue', 'Navy', 'Blue'], 'Blue'],
    ['Navy Blue', ['Light Green', 'Red'], null],
    ['', ['A'], null],
    ['Nike', [], null],
  ];
  it.each(table)('wanted %j in %j → %j', (wanted, options, expected) => {
    expect(bestMatch(wanted, options)?.option ?? null).toBe(expected);
  });
  it('prefers the shorter option on ties and respects minScore', () => {
    expect(bestMatch('Shoes', ['Shoes for men', 'Shoes women special'])?.option).toBe('Shoes for men');
    expect(bestMatch('Boots', ['Boots & Booties'], 0.95)).toBeNull();
    expect(bestMatch('Boots', ['Boots & Booties'], 0.9)?.score).toBe(0.9);
  });
  it('uses token overlap for partial matches', () => {
    expect(bestMatch('Extra Large', ['Small', 'Large'])).toEqual({ option: 'Large', score: 0.65 }); // 1 of 2 tokens shared
    expect(bestMatch('Nike Air Max', ['Nike Air Max 90'])?.score).toBe(0.9);
    const m = bestMatch('Air Max Nike', ['Nike Air Max 90']);
    expect(m?.score).toBeCloseTo(0.5 + 0.3 * 0.75);
  });
});
