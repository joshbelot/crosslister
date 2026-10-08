import type { ColorId } from '../../shared/colors';
import type { Condition, JobState, JobType, ListingStatus, MarketplaceId, MarketplaceListingStatus, StepState } from '../../shared/constants';
import type {
  Job, JobStep, Listing, MarketplaceListing, Measurements, NeedsUserRequest, Photo, ShippingInfo,
} from '../../shared/types';
import type { JobRow, JobStepRow, ListingRow, MarketplaceListingRow, PhotoRow } from '../db/schema';

export function photoUrls(id: string, version: number): Photo['urls'] {
  return {
    thumb: `/api/photos/${id}/thumb?v=${version}`,
    display: `/api/photos/${id}/display?v=${version}`,
    original: `/api/photos/${id}/original`,
  };
}

export function rowToPhoto(r: PhotoRow): Photo {
  return {
    id: r.id, listingId: r.listingId, position: r.position, originalFilename: r.originalFilename,
    mimeType: r.mimeType, width: r.width, height: r.height, bytes: r.bytes, sha256: r.sha256, dhash: r.dhash,
    rotation: r.rotation as Photo['rotation'], crop: r.crop ?? null, version: r.version,
    urls: photoUrls(r.id, r.version), createdAt: r.createdAt,
  };
}

export function rowToListing(r: ListingRow): Listing {
  return {
    id: r.id, sku: r.sku, title: r.title, description: r.description, priceCents: r.priceCents,
    msrpCents: r.msrpCents, costCents: r.costCents, currency: 'USD',
    condition: (r.condition as Condition | null) ?? null, conditionNotes: r.conditionNotes,
    categoryId: r.categoryId, brand: r.brand, model: r.model, size: r.size,
    colors: r.colors as ColorId[], material: r.material, quantity: r.quantity,
    measurements: r.measurements as Measurements, tags: r.tags, shipping: r.shipping as unknown as ShippingInfo,
    notes: r.notes, status: r.status as ListingStatus, source: r.source as Listing['source'],
    soldAt: r.soldAt, soldPriceCents: r.soldPriceCents,
    soldMarketplaceId: (r.soldMarketplaceId as MarketplaceId | 'elsewhere' | null) ?? null,
    saleDetectedMarketplaceId: (r.saleDetectedMarketplaceId as MarketplaceId | null) ?? null,
    saleDetectedAt: r.saleDetectedAt, archivedAt: r.archivedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export function rowToMarketplaceListing(r: MarketplaceListingRow): MarketplaceListing {
  return {
    id: r.id, listingId: r.listingId, marketplaceId: r.marketplaceId as MarketplaceId,
    status: r.status as MarketplaceListingStatus, remoteId: r.remoteId, url: r.url,
    titleOverride: r.titleOverride, descriptionOverride: r.descriptionOverride,
    priceOverrideCents: r.priceOverrideCents, data: r.data ?? {}, verified: r.verified,
    lastError: r.lastError, lastErrorCode: r.lastErrorCode, listedAt: r.listedAt, endedAt: r.endedAt,
    lastSyncedAt: r.lastSyncedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export function rowToStep(r: JobStepRow): JobStep {
  return {
    id: r.id, jobId: r.jobId, seq: r.seq, key: r.key, label: r.label, state: r.state as StepState,
    message: r.message,
    screenshotUrl: r.screenshotPath ? `/api/jobs/${r.jobId}/steps/${r.id}/screenshot` : null,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
  };
}

export function rowToJob(r: JobRow, steps?: JobStepRow[], listingTitle?: string): Job {
  const job: Job = {
    id: r.id, type: r.type as JobType, marketplaceId: (r.marketplaceId as MarketplaceId | null) ?? null,
    listingId: r.listingId, state: r.state as JobState,
    needsUser: (r.needsUser as NeedsUserRequest | null) ?? null,
    errorCode: r.errorCode, errorMessage: r.errorMessage, result: r.result ?? null,
    attempt: r.attempt, parentJobId: r.parentJobId, createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
  };
  if (steps) job.steps = steps.map(rowToStep);
  if (listingTitle !== undefined) job.listingTitle = listingTitle;
  return job;
}
