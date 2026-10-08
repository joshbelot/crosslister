import { z } from 'zod';
import type { MarketplaceId } from '../../../shared/constants';
import { categoryPathLabel } from '../../../shared/taxonomy';
import { CONDITION_LABELS } from '../../../shared/constants';
import { formatCents } from '../../../shared/money';
import type { MarketplaceCapabilities } from '../../../shared/types';
import { processedDir } from '../../paths';
import { standardCopyFields, hostOk, lastPathSegment } from '../common';
import type { EffectiveListing, MarketplaceAdapter } from '../types';

export function manualAdapter(
  id: MarketplaceId, name: string, urls: { home: string; sell: string }, capOverrides: Partial<MarketplaceCapabilities> = {},
): MarketplaceAdapter {
  const capabilities: MarketplaceCapabilities = {
    publish: 'manual', update: 'manual', deactivate: 'manual', statusCheck: 'none', import: 'url',
    autoSubmitAllowed: false, maxPhotos: 24, titleMaxLength: 100, descriptionMaxLength: 5000,
    minPriceCents: 100, maxPriceCents: null, requires: ['title', 'price'], ...capOverrides,
  };
  const describeMapping = (l: EffectiveListing) => [
    { label: 'Condition', value: l.condition ? CONDITION_LABELS[l.condition] : '' },
    { label: 'Category', value: l.categoryId ? categoryPathLabel(l.categoryId) : '' },
  ].filter((m) => m.value);
  const homeHost = (() => { try { return new URL(urls.home).hostname.replace(/^www\./, ''); } catch { return null; } })();

  const adapter: MarketplaceAdapter = {
    id, name, kind: 'manual', capabilities,
    photoSpec: { maxPhotos: 24, maxLongEdge: 2048, quality: 88 },
    urls: { home: urls.home, sell: urls.sell },
    dataSchema: z.object({}),
    dataFields: [],
    validate(l) {
      if (id === 'etsy') {
        return [{ field: 'category', severity: 'warning', message: 'Etsy only allows handmade items, vintage items (20+ years old) and craft supplies.' }];
      }
      void l;
      return [];
    },
    describeMapping,
    parseListingUrl(url) {
      if (homeHost === null || !/^https?:\/\//i.test(url)) return null;
      try { new URL(url); } catch { return null; }
      if (!hostOk(url, [homeHost])) return null;
      return { remoteId: lastPathSegment(url), url };
    },
    listingUrl: () => urls.home,
    async connect() {
      return { status: 'connected', accountName: null, message: 'Manual marketplace — nothing to connect.' };
    },
    async publish(ctx, l) {
      const answer = await ctx.requestUser({
        reason: 'manual_listing',
        title: `List on ${name}`,
        instructions: `Create the listing on ${name} using the values below (click a value to copy it). Drag the photos from the photos folder. Then paste the listing's address below.`,
        copyFields: standardCopyFields(l, describeMapping(l)),
        photoFolder: processedDir(l.listingId, id),
        link: { label: `Open ${name}`, url: urls.sell },
        allowUrlInput: true,
        primaryAction: 'I listed it',
      });
      if (!answer.url) return { remoteId: null, url: null, verified: false };
      const parsed = adapter.parseListingUrl(answer.url);
      return parsed ? { ...parsed, verified: true } : { remoteId: null, url: answer.url, verified: false };
    },
    async update(ctx, l, ml) {
      await ctx.requestUser({
        reason: 'manual_listing',
        title: `Update on ${name}`,
        instructions: `Update the title, description and price on ${name}.`,
        copyFields: [
          { label: 'Title', value: l.title },
          { label: 'Description', value: l.description },
          { label: 'Price', value: formatCents(l.priceCents) },
        ].filter((f) => f.value),
        link: { label: 'Open listing', url: ml.url ?? urls.home },
        primaryAction: 'Done',
      });
    },
    async deactivate(ctx, ml) {
      await ctx.requestUser({
        reason: 'manual_delist',
        title: `Remove from ${name}`,
        instructions: `Delete the listing or mark it as sold on ${name}, then click “It's removed”.`,
        link: { label: 'Open listing', url: ml.url ?? urls.home },
        primaryAction: "It's removed",
      });
    },
  };
  return adapter;
}
