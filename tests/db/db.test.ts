import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import * as s from '../../src/server/db/schema';

const now = () => new Date().toISOString();
const shipping = { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' };

describe('db', () => {
  it('migrates and round-trips JSON columns', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    db.insert(s.listings).values({ id: 'a1', sku: 'CL-00001', shipping, createdAt: now(), updatedAt: now(), colors: ['red'] }).run();
    const row = db.select().from(s.listings).where(eq(s.listings.id, 'a1')).get();
    expect(row?.colors).toEqual(['red']);
    expect(row?.tags).toEqual([]);
    expect(row?.status).toBe('draft');
    expect(row?.shipping).toEqual(shipping);
  });
  it('enforces unique SKU and cascades deletes', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    db.insert(s.listings).values({ id: 'a1', sku: 'CL-00001', shipping, createdAt: now(), updatedAt: now() }).run();
    expect(() => db.insert(s.listings).values({ id: 'a2', sku: 'CL-00001', shipping, createdAt: now(), updatedAt: now() }).run()).toThrow();
    db.insert(s.marketplaceListings).values({ id: 'm1', listingId: 'a1', marketplaceId: 'ebay', createdAt: now(), updatedAt: now() }).run();
    expect(() => db.insert(s.marketplaceListings).values({ id: 'm2', listingId: 'a1', marketplaceId: 'ebay', createdAt: now(), updatedAt: now() }).run()).toThrow();
    db.delete(s.listings).where(eq(s.listings.id, 'a1')).run();
    expect(db.select().from(s.marketplaceListings).all()).toHaveLength(0);
  });
});
