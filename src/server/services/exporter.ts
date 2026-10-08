import { asc } from 'drizzle-orm';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import { categoryPathLabel } from '../../shared/taxonomy';
import type { Listing, MarketplaceListing } from '../../shared/types';
import type { Db } from '../db/client';
import { listings, marketplaceListings, photos } from '../db/schema';
import { rowToListing, rowToMarketplaceListing } from './mappers';

export interface ExportPhoto {
  id: string; position: number; originalFilename: string; file: string; sha256: string; width: number; height: number;
  rotation: number; crop: { x: number; y: number; width: number; height: number } | null;
}
export type ExportMarketplace = Pick<MarketplaceListing,
  'marketplaceId' | 'status' | 'remoteId' | 'url' | 'titleOverride' | 'descriptionOverride' | 'priceOverrideCents' | 'data' | 'verified' | 'listedAt' | 'endedAt' | 'lastSyncedAt'>;
export type ExportListing = Listing & { photos: ExportPhoto[]; marketplaces: ExportMarketplace[] };
export interface ExportFile { exportVersion: 1; app: 'crosslister'; exportedAt: string; listings: ExportListing[] }

export function buildExport(db: Db): ExportFile {
  const photoRows = db.select().from(photos).orderBy(asc(photos.position)).all();
  const mlRows = db.select().from(marketplaceListings).all().map(rowToMarketplaceListing);
  const out: ExportListing[] = db.select().from(listings).orderBy(asc(listings.sku)).all().map((row) => {
    const l = rowToListing(row);
    return {
      ...l,
      photos: photoRows.filter((p) => p.listingId === l.id).map((p): ExportPhoto => ({
        id: p.id, position: p.position, originalFilename: p.originalFilename,
        file: `listings/${l.id}/original/${p.storedFilename}`, sha256: p.sha256, width: p.width, height: p.height,
        rotation: p.rotation, crop: p.crop ?? null,
      })),
      marketplaces: mlRows.filter((m) => m.listingId === l.id)
        .sort((a, b) => MARKETPLACE_ORDER.indexOf(a.marketplaceId) - MARKETPLACE_ORDER.indexOf(b.marketplaceId))
        .map((m): ExportMarketplace => ({
          marketplaceId: m.marketplaceId, status: m.status, remoteId: m.remoteId, url: m.url, titleOverride: m.titleOverride,
          descriptionOverride: m.descriptionOverride, priceOverrideCents: m.priceOverrideCents, data: m.data, verified: m.verified,
          listedAt: m.listedAt, endedAt: m.endedAt, lastSyncedAt: m.lastSyncedAt,
        })),
    };
  });
  return { exportVersion: 1, app: 'crosslister', exportedAt: new Date().toISOString(), listings: out };
}

/** RFC 4180 row: quote every field containing `"`, `,`, CR or LF. */
export function toCsvRow(values: string[]): string {
  return values.map((v) => (/["\r\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
}

const dollars = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

export function buildCsv(db: Db): string {
  const data = buildExport(db);
  const header = [
    'sku', 'id', 'title', 'description', 'price', 'msrp', 'cost', 'condition', 'category', 'brand', 'model', 'size', 'colors',
    'material', 'quantity', 'tags', 'weight_oz', 'status', 'source', 'sold_at', 'sold_price', 'sold_on', 'created_at', 'updated_at',
    'photo_count', 'primary_photo_file',
    ...MARKETPLACE_ORDER.flatMap((mp) => [`${mp}_status`, `${mp}_id`, `${mp}_url`]),
  ];
  const lines = [toCsvRow(header)];
  for (const l of data.listings) {
    lines.push(toCsvRow([
      l.sku, l.id, l.title, l.description, dollars(l.priceCents), dollars(l.msrpCents), dollars(l.costCents), l.condition ?? '',
      l.categoryId ? categoryPathLabel(l.categoryId) : '', l.brand, l.model, l.size, l.colors.join(';'), l.material, String(l.quantity),
      l.tags.join(';'), l.shipping.weightOz === null ? '' : String(l.shipping.weightOz), l.status, l.source, l.soldAt ?? '',
      dollars(l.soldPriceCents), l.soldMarketplaceId ?? '', l.createdAt, l.updatedAt, String(l.photos.length), l.photos[0]?.file ?? '',
      ...MARKETPLACE_ORDER.flatMap((mp) => {
        const m = l.marketplaces.find((x) => x.marketplaceId === mp);
        return [m?.status ?? '', m?.remoteId ?? '', m?.url ?? ''];
      }),
    ]));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
