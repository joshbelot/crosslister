import { describe, expect, it } from 'vitest';
import { jaccard, normalizeText, tokenSet, truncateAtWord } from '../../src/shared/text';

describe('text', () => {
  it('normalizes', () => {
    expect(normalizeText('  Crème Brûlée!! – Café  ')).toBe('creme brulee cafe');
    expect(normalizeText("Levi's 501®")).toBe('levi s 501');
  });
  it('truncates at word boundaries', () => {
    expect(truncateAtWord('hello world foo', 11)).toBe('hello world');
    expect(truncateAtWord('hello world foo', 13)).toBe('hello world');
    expect(truncateAtWord('hello world', 50)).toBe('hello world');
    expect(truncateAtWord('abcdefghij', 4)).toBe('abcd');
  });
  it('jaccard', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(tokenSet('nike air max'), tokenSet('nike air max'))).toBe(1);
    expect(jaccard(tokenSet('a nike'), tokenSet('nike'))).toBe(1);
    expect(jaccard(tokenSet('nike air'), tokenSet('nike max'))).toBeCloseTo(1 / 3);
  });
});
