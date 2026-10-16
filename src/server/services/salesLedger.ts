import { and, asc, desc, eq, gte, isNull, like, lte, or } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import type { Sale, SalesTotals } from '../../shared/types';
import type { Db } from '../db/client';
import { listings, photos, sales } from '../db/schema';
import { notFound } from '../errors';
import { nanoid12 } from '../ids';
import { toCsvRow } from './exporter';
import { photoUrls } from './mappers';

type SaleRow = typeof sales.$inferSelect;
const nowIso = () => new Date().toISOString();

export interface SaleQuery { from?: string; to?: string; marketplaceId?: string; q?: string }

export interface CreateSaleInput {
  listingId: string; marketplaceId: MarketplaceId | 'elsewhere'; soldAt: string; salePriceCents: number | null; source: Sale['source'];
  shippingChargedCents?: number | null; marketplaceFeesCents?: number | null; shippingCostCents?: number | null; otherCostsCents?: number | null;
  buyer?: string; orderUrl?: string | null; notes?: string;
}

export interface SaleEditable {
  soldAt?: string; marketplaceId?: MarketplaceId | 'elsewhere';
  salePriceCents?: number | null; shippingChargedCents?: number | null; marketplaceFeesCents?: number | null;
  shippingCostCents?: number | null; otherCostsCents?: number | null; itemCostCents?: number | null;
  buyer?: string; orderUrl?: string | null; notes?: string;
}

function thumbFor(db: Db, listingId: string | null): string | null {
  if (!listingId) return null;
  const p = db.select({ id: photos.id, version: photos.version }).from(photos).where(eq(photos.listingId, listingId)).orderBy(asc(photos.position)).limit(1).get();
  return p ? photoUrls(p.id, p.version).thumb : null;
}

function net(r: SaleRow): number | null {
  if (r.salePriceCents === null) return null;
  return r.salePriceCents + (r.shippingChargedCents ?? 0) - (r.marketplaceFeesCents ?? 0) - (r.shippingCostCents ?? 0)
    - (r.otherCostsCents ?? 0) - (r.itemCostCents ?? 0);
}

export function rowToSale(db: Db, r: SaleRow): Sale {
  return {
    id: r.id, listingId: r.listingId, marketplaceId: r.marketplaceId as Sale['marketplaceId'], soldAt: r.soldAt, title: r.title, sku: r.sku,
    thumbUrl: thumbFor(db, r.listingId), salePriceCents: r.salePriceCents, shippingChargedCents: r.shippingChargedCents,
    marketplaceFeesCents: r.marketplaceFeesCents, shippingCostCents: r.shippingCostCents, otherCostsCents: r.otherCostsCents,
    itemCostCents: r.itemCostCents, netCents: net(r), buyer: r.buyer, orderUrl: r.orderUrl, notes: r.notes, source: r.source as Sale['source'],
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export function createSale(db: Db, input: CreateSaleInput): Sale {
  const l = db.select().from(listings).where(eq(listings.id, input.listingId)).get();
  if (!l) throw notFound('Listing');
  const now = nowIso();
  const id = nanoid12();
  db.insert(sales).values({
    id, listingId: l.id, marketplaceId: input.marketplaceId, soldAt: input.soldAt, title: l.title, sku: l.sku,
    salePriceCents: input.salePriceCents, shippingChargedCents: input.shippingChargedCents ?? null,
    marketplaceFeesCents: input.marketplaceFeesCents ?? null, shippingCostCents: input.shippingCostCents ?? null,
    otherCostsCents: input.otherCostsCents ?? null, itemCostCents: l.costCents ?? null,
    buyer: input.buyer ?? '', orderUrl: input.orderUrl ?? null, notes: input.notes ?? '', source: input.source, createdAt: now, updatedAt: now,
  }).run();
  return rowToSale(db, db.select().from(sales).where(eq(sales.id, id)).get()!);
}

export function deleteSalesForListing(db: Db, listingId: string): void {
  db.delete(sales).where(eq(sales.listingId, listingId)).run();
}

/** The newest sale row of a listing (shown on its detail page). */
export function latestSaleForListing(db: Db, listingId: string): Sale | null {
  const r = db.select().from(sales).where(eq(sales.listingId, listingId)).orderBy(desc(sales.soldAt), desc(sales.createdAt)).limit(1).get();
  return r ? rowToSale(db, r) : null;
}

function conditions(q: SaleQuery) {
  const c = [];
  if (q.from) c.push(gte(sales.soldAt, q.from));
  if (q.to) c.push(lte(sales.soldAt, q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to));
  if (q.marketplaceId) c.push(eq(sales.marketplaceId, q.marketplaceId));
  if (q.q?.trim()) {
    const p = `%${q.q.trim()}%`;
    c.push(or(like(sales.title, p), like(sales.sku, p))!);
  }
  return c.length ? and(...c) : undefined;
}

export function listSales(db: Db, q: SaleQuery = {}): { items: Sale[]; totals: SalesTotals } {
  const rows = db.select().from(sales).where(conditions(q)).orderBy(desc(sales.soldAt), desc(sales.createdAt)).all();
  const items = rows.map((r) => rowToSale(db, r));
  const totals: SalesTotals = { count: items.length, revenueCents: 0, feesCents: 0, netCents: 0 };
  for (const s of items) {
    totals.revenueCents += (s.salePriceCents ?? 0) + (s.shippingChargedCents ?? 0);
    totals.feesCents += s.marketplaceFeesCents ?? 0;
    totals.netCents += s.netCents ?? 0;
  }
  return { items, totals };
}

export function updateSale(db: Db, id: string, patch: SaleEditable): Sale {
  const existing = db.select().from(sales).where(eq(sales.id, id)).get();
  if (!existing) throw notFound('Sale');
  const set: Partial<typeof sales.$inferInsert> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (set as Record<string, unknown>)[k] = v;
  db.update(sales).set(set).where(eq(sales.id, id)).run();
  return rowToSale(db, db.select().from(sales).where(eq(sales.id, id)).get()!);
}

const dollars = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

export function salesCsv(db: Db, q: SaleQuery = {}): string {
  const lines = [toCsvRow(['Sold at', 'Title', 'SKU', 'Platform', 'Sale price', 'Shipping charged', 'Fees', 'Shipping cost', 'Other costs', 'Item cost', 'Net', 'Buyer', 'Order link', 'Notes', 'Source'])];
  for (const s of listSales(db, q).items) {
    lines.push(toCsvRow([
      s.soldAt, s.title, s.sku, s.marketplaceId, dollars(s.salePriceCents), dollars(s.shippingChargedCents), dollars(s.marketplaceFeesCents),
      dollars(s.shippingCostCents), dollars(s.otherCostsCents), dollars(s.itemCostCents), dollars(s.netCents), s.buyer, s.orderUrl ?? '', s.notes, s.source,
    ]));
  }
  return lines.join('\n') + '\n';
}

/** Give every sold listing without a sale row one (older versions only stored the sale on the listing). */
export function backfillSales(db: Db): number {
  const missing = db.select().from(listings).leftJoin(sales, eq(sales.listingId, listings.id)).where(and(isNull(sales.id))).all()
    .filter((r) => r.listings.soldAt);
  for (const { listings: l } of missing) {
    createSale(db, {
      listingId: l.id, marketplaceId: (l.soldMarketplaceId ?? 'elsewhere') as MarketplaceId | 'elsewhere', soldAt: l.soldAt!,
      salePriceCents: l.soldPriceCents ?? null, source: 'manual',
    });
  }
  return missing.length;
}
