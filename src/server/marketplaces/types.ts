import type { Page } from 'playwright';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { ColorId } from '../../shared/colors';
import type { Condition, MarketplaceId } from '../../shared/constants';
import type { SizeType } from '../../shared/taxonomy';
import type {
  DataFieldDef, Listing, MarketplaceCapabilities, MarketplaceListing, Measurements, ShippingInfo, ValidationIssue,
} from '../../shared/types';
import type { LocatorSpec } from '../browser/locators';
import type { Db } from '../db/client';
import type { PhotoRow } from '../db/schema';
import type { PhotoSpec } from '../services/imageProcessing';
import type { JobContext } from '../services/jobContext';

export type { DataFieldDef };

export interface EffectiveListing<TData = Record<string, unknown>> {
  listingId: string;
  sku: string;
  marketplaceId: MarketplaceId;
  title: string;                // after override + truncation
  titleTruncated: boolean;
  description: string;          // composed (see 05 §3)
  priceCents: number | null;    // override ?? adjusted base
  msrpCents: number | null;
  condition: Condition | null;
  conditionNotes: string;
  categoryId: string | null;
  categoryLabels: string[];     // canonical labels root→leaf, e.g. ['Men','Shoes','Sneakers']
  department: string | null;    // 'women' | 'men' | ...
  sizeType: SizeType;
  brand: string; model: string; size: string; colors: ColorId[]; material: string;
  quantity: number; measurements: Measurements; tags: string[]; shipping: ShippingInfo;
  photos: PhotoRow[];           // ordered by position, sliced to capabilities.maxPhotos
  photoPaths: string[];         // processed files; [] until the job prepares photos
  data: TData;                  // parsed with adapter.dataSchema (defaults applied)
  dataErrors: string[];         // zod issues if parsing failed (then `data` = schema defaults)
}

export interface PublishResult { remoteId: string | null; url: string | null; verified: boolean }
export type RemoteStatus = 'active' | 'sold' | 'ended' | 'unknown';
export interface ConnectionResult { status: 'connected' | 'logged_out' | 'not_configured'; accountName: string | null; message: string | null }

/** Phase 4 importer contract (07); fleshed out in M27. */
export interface MarketplaceImporter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MarketplaceAdapter<TData = Record<string, unknown>> {
  id: MarketplaceId;
  name: string;
  kind: 'browser' | 'api' | 'manual';
  capabilities: MarketplaceCapabilities;
  photoSpec: PhotoSpec;
  urls: { home: string; sell: string; login?: string; myListings?: string };
  dataSchema: z.ZodType<TData>;
  dataFields: DataFieldDef[];

  /** Marketplace-specific checks; common checks are added by validation.ts. */
  validate(listing: EffectiveListing<TData>): ValidationIssue[];
  /** Mapped values shown in previews and copy panels (e.g. condition label, category path). */
  describeMapping(listing: EffectiveListing<TData>): Array<{ label: string; value: string }>;
  /** Recognize a listing URL of this marketplace (pathname-based). */
  parseListingUrl(url: string): { remoteId: string; url: string } | null;
  /** Build the public URL for a remote id (used when only the id is known). */
  listingUrl(remoteId: string): string;

  connect(ctx: JobContext): Promise<ConnectionResult>;
  /** Optional: extra cleanup when the user disconnects (e.g. eBay deletes its stored tokens). */
  disconnect?(db: Db): Promise<void>;
  publish(ctx: JobContext, listing: EffectiveListing<TData>): Promise<PublishResult>;
  update?(ctx: JobContext, listing: EffectiveListing<TData>, ml: MarketplaceListing): Promise<void>;
  deactivate(ctx: JobContext, ml: MarketplaceListing): Promise<void>;
  checkStatus?(ctx: JobContext, ml: MarketplaceListing): Promise<RemoteStatus>;
  importer?: MarketplaceImporter;               // Phase 4 (07)

  /** Optional: built-in category path for a canonical category (used by the Settings category map). */
  categoryPath?(categoryId: string): Array<string | string[]> | null;
  /** Optional: rewrite the composed description (e.g. Depop prepends the title and appends hashtags). */
  finalizeDescription?(l: EffectiveListing<TData>): string;
  /** Optional async enrichment run in the background when this marketplace is added as a target or the listing's title/brand/category changes. Must never throw. */
  prepare?(db: Db, listing: Listing, ml: MarketplaceListing): Promise<Record<string, unknown>>;
  /** Optional extra routes under /api/marketplaces/<id>/… (e.g. eBay category search). */
  registerRoutes?(app: FastifyInstance): void;
}

export interface BrowserAdapter<TData = Record<string, unknown>> extends MarketplaceAdapter<TData> {
  kind: 'browser';
  auth: { loginUrl: string; loginUrlPattern: RegExp; loggedInIndicator: LocatorSpec; challengeIndicator?: LocatorSpec };
  listingPathRegex: RegExp;                       // capture group 1 = remote id
  selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]>;
  soldIndicator?: LocatorSpec;                    // 08 §3
  readAccountName?(page: Page): Promise<string | null>;
}
