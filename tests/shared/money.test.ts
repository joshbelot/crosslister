import { describe, expect, it } from 'vitest';
import { applyPriceAdjust, formatCents, formatCentsShort, parsePriceToCents } from '../../src/shared/money';

describe('money', () => {
  it('parses prices', () => {
    expect(parsePriceToCents('$65')).toBe(6500);
    expect(parsePriceToCents('65.5')).toBe(6550);
    expect(parsePriceToCents('1,200.00')).toBe(120000);
    expect(parsePriceToCents(' 65.00 ')).toBe(6500);
    expect(parsePriceToCents('')).toBeNull();
    expect(parsePriceToCents('abc')).toBeNull();
    expect(parsePriceToCents('-5')).toBeNull();
    expect(parsePriceToCents('1.999')).toBeNull();
  });
  it('formats', () => {
    expect(formatCents(6500)).toBe('$65.00');
    expect(formatCents(null)).toBe('');
    expect(formatCentsShort(6500)).toBe('$65');
    expect(formatCentsShort(6550)).toBe('$65.50');
  });
  it('adjusts prices and rounds to whole dollars', () => {
    expect(applyPriceAdjust(6500, 0)).toBe(6500);
    expect(applyPriceAdjust(6550, 0)).toBe(6550);
    expect(applyPriceAdjust(6500, 10)).toBe(7200);
    expect(applyPriceAdjust(6500, -20)).toBe(5200);
  });
});
