import type { MarketplaceId } from '../../shared/constants';
import type { JobContext } from '../services/jobContext';
import type { RemoteStatus } from '../marketplaces/types';

export interface DiscoveredItem { remoteId: string; url: string; title: string; thumbUrl: string | null }

export interface ImportedListing {
  remoteId: string; url: string;
  title: string; description: string; priceCents: number | null;
  conditionText: string | null;            // raw marketplace label or schema.org value
  categoryTexts: string[];                 // breadcrumb segments, most general first
  brand: string; size: string; colorTexts: string[];
  photoUrls: string[];
  status: RemoteStatus;                    // active | sold | ended | unknown
  quantity: number;
  extra: Record<string, string>;           // anything else worth keeping in notes (e.g. eBay SKU)
}

export interface MarketplaceImporter {
  methods: Array<'api' | 'shop_page' | 'urls'>;
  scan?(ctx: JobContext): Promise<DiscoveredItem[]>;                 // api / shop_page
  fetch(ctx: JobContext, item: { remoteId: string | null; url: string }): Promise<ImportedListing>;
  downloadPhoto(ctx: JobContext, url: string, dest: string): Promise<void>;
}

export type ImportMarketplaceId = MarketplaceId;
