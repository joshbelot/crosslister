import type { MarketplaceId } from '../../shared/constants';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import { AppError } from '../errors';
import { setNoAutoSubmitProvider } from '../services/settings';
import { manualAdapter } from './manual';
import type { MarketplaceAdapter } from './types';

// Until a marketplace's own milestone lands, it is registered as a manual adapter (Phase 1 supports every marketplace manually).
// The registry's array is the one permitted `any`: adapters have different TData.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapters: MarketplaceAdapter<any>[] = [
  manualAdapter('mercari', 'Mercari', { home: 'https://www.mercari.com/', sell: 'https://www.mercari.com/sell/' }),
  manualAdapter('poshmark', 'Poshmark', { home: 'https://poshmark.com/', sell: 'https://poshmark.com/create-listing' }),
  manualAdapter('depop', 'Depop', { home: 'https://www.depop.com/', sell: 'https://www.depop.com/products/create/' }),
  manualAdapter('facebook', 'Facebook Marketplace', { home: 'https://www.facebook.com/marketplace/', sell: 'https://www.facebook.com/marketplace/create/item' }),
  manualAdapter('ebay', 'eBay', { home: 'https://www.ebay.com/', sell: 'https://www.ebay.com/sl/sell' }),
  manualAdapter('grailed', 'Grailed', { home: 'https://www.grailed.com/', sell: 'https://www.grailed.com/sell' }),
  manualAdapter('vinted', 'Vinted', { home: 'https://www.vinted.com/', sell: 'https://www.vinted.com/items/new' }, { titleMaxLength: 100, descriptionMaxLength: 2000 }),
  manualAdapter('offerup', 'OfferUp', { home: 'https://offerup.com/', sell: 'https://offerup.com/' }),
  manualAdapter('etsy', 'Etsy', { home: 'https://www.etsy.com/', sell: 'https://www.etsy.com/your/shops/me/listing-editor/create' }, { titleMaxLength: 140, descriptionMaxLength: 10000 }),
  manualAdapter('other', 'Other', { home: 'about:blank', sell: 'about:blank' }),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAdapter(id: MarketplaceId): MarketplaceAdapter<any> {
  const a = adapters.find((x) => x.id === id);
  if (!a) throw new AppError('UNKNOWN_MARKETPLACE', 404, 'That marketplace is not supported.');
  return a;
}

/** In MARKETPLACE_ORDER. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allAdapters(): MarketplaceAdapter<any>[] {
  return [...adapters].sort((a, b) => MARKETPLACE_ORDER.indexOf(a.id) - MARKETPLACE_ORDER.indexOf(b.id));
}

/** Test-only: replace adapters (e.g. with scripted fakes). Pass `null` to restore the real list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const original = adapters;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setAdaptersForTest(next: MarketplaceAdapter<any>[] | null): void {
  adapters = next ?? original;
}

setNoAutoSubmitProvider(() => adapters.filter((a) => !a.capabilities.autoSubmitAllowed).map((a) => a.id));
