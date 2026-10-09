import { z } from 'zod';
import type { MarketplaceId } from '../../src/shared/constants';
import type { MarketplaceCapabilities } from '../../src/shared/types';
import type { JobContext } from '../../src/server/services/jobContext';
import type { EffectiveListing, MarketplaceAdapter, PublishResult } from '../../src/server/marketplaces/types';
import type { MarketplaceListing } from '../../src/shared/types';

export interface FakeScript {
  kind?: 'api' | 'browser' | 'manual';
  caps?: Partial<MarketplaceCapabilities>;
  publish?: (ctx: JobContext, l: EffectiveListing) => Promise<PublishResult>;
  deactivate?: (ctx: JobContext, ml: MarketplaceListing) => Promise<void>;
  update?: (ctx: JobContext, l: EffectiveListing, ml: MarketplaceListing) => Promise<void>;
  connect?: (ctx: JobContext) => ReturnType<MarketplaceAdapter['connect']>;
}

/** A scripted adapter for job tests. */
export function fakeAdapter(id: MarketplaceId, script: FakeScript = {}): MarketplaceAdapter {
  const home = `https://${id}.example.com/`;
  return {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), kind: script.kind ?? 'manual',
    capabilities: {
      publish: 'manual', update: 'manual', deactivate: 'manual', statusCheck: 'none', import: 'none', autoSubmitAllowed: false,
      maxPhotos: 24, titleMaxLength: 100, descriptionMaxLength: 5000, minPriceCents: 100, maxPriceCents: null,
      requires: ['title', 'price'], ...script.caps,
    },
    photoSpec: { maxPhotos: 24, maxLongEdge: 800, quality: 80 },
    urls: { home, sell: home + 'sell' },
    dataSchema: z.object({}), dataFields: [],
    validate: () => [],
    describeMapping: () => [],
    parseListingUrl: (url) => (url.startsWith(home) ? { remoteId: url.slice(home.length).replace(/\/$/, '') || 'x', url } : null),
    listingUrl: (rid) => `${home}${rid}`,
    connect: script.connect ?? (async () => ({ status: 'connected', accountName: 'tester', message: null })),
    publish: script.publish ?? (async () => ({ remoteId: 'r1', url: `${home}r1`, verified: true })),
    deactivate: script.deactivate ?? (async () => undefined),
    ...(script.update ? { update: script.update } : {}),
  };
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}
