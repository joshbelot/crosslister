import { describe, expect, it } from 'vitest';
import { listingPatchSchema } from '../../src/shared/schemas';

describe('listingPatchSchema', () => {
  it('accepts a partial patch', () => {
    expect(listingPatchSchema.safeParse({ title: 'x', categoryId: 'men.tops.polos' }).success).toBe(true);
  });
  it('rejects bad values', () => {
    expect(listingPatchSchema.safeParse({ categoryId: 'men.tops' }).success).toBe(false);
    expect(listingPatchSchema.safeParse({ colors: ['red', 'blue', 'green'] }).success).toBe(false);
    expect(listingPatchSchema.safeParse({ priceCents: -1 }).success).toBe(false);
    expect(listingPatchSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});
