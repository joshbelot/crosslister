import { describe, expect, it } from 'vitest';
import { normalizeSize, sizeSynonyms } from '../../src/shared/sizes';

describe('sizes', () => {
  it('normalizes', () => {
    expect(normalizeSize('  xl ', 'letter')).toBe('XL');
    expect(normalizeSize('xxxl', 'letter')).toBe('3XL');
    expect(normalizeSize('OS', 'one_size')).toBe('One Size');
    expect(normalizeSize('one  size', 'letter')).toBe('One Size');
    expect(normalizeSize('o/s', 'none')).toBe('One Size');
    expect(normalizeSize('10.5', 'shoe_men')).toBe('10.5');
    expect(normalizeSize('xl', 'waist')).toBe('xl');
  });
  it('synonyms', () => {
    expect(sizeSynonyms('M')).toEqual(['M', 'Medium']);
    expect(sizeSynonyms('XL')).toContain('Extra Large');
    expect(sizeSynonyms('11')).toEqual(['11', 'US 11', '11 US']);
    expect(sizeSynonyms('32')).toContain('W32');
    expect(sizeSynonyms('One Size')).toContain('O/S');
    expect(sizeSynonyms('weird')).toEqual(['weird']);
  });
});
