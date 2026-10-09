import type { MarketplaceId } from '../../shared/constants';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import { AppError } from '../errors';
import { setNoAutoSubmitProvider } from '../services/settings';
import { manualAdapter } from './manual';
import { depopAdapter } from './depop';
import { ebayAdapter } from './ebay';
import { facebookAdapter } from './facebook';
import { grailedAdapter } from './grailed';
import { mercariAdapter } from './mercari';
import { poshmarkAdapter } from './poshmark';
import type { MarketplaceAdapter } from './types';

// Built lazily: some adapters import services that import this registry (import cycle), so the list must not be evaluated at module load.
// The registry's array is the one permitted `any`: adapters have different TData.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAdapter = MarketplaceAdapter<any>;
let defaults: AnyAdapter[] | null = null;
let override: AnyAdapter[] | null = null;

function defaultAdapters(): AnyAdapter[] {
  return (defaults ??= [
    mercariAdapter,
    poshmarkAdapter,
    depopAdapter,
    facebookAdapter,
    ebayAdapter,
    grailedAdapter,
    manualAdapter('vinted', 'Vinted', { home: 'https://www.vinted.com/', sell: 'https://www.vinted.com/items/new' }, { titleMaxLength: 100, descriptionMaxLength: 2000 }),
    manualAdapter('offerup', 'OfferUp', { home: 'https://offerup.com/', sell: 'https://offerup.com/' }),
    manualAdapter('etsy', 'Etsy', { home: 'https://www.etsy.com/', sell: 'https://www.etsy.com/your/shops/me/listing-editor/create' }, { titleMaxLength: 140, descriptionMaxLength: 10000 }),
    manualAdapter('other', 'Other', { home: 'about:blank', sell: 'about:blank' }),
  ]);
}
const current = (): AnyAdapter[] => override ?? defaultAdapters();

export function getAdapter(id: MarketplaceId): AnyAdapter {
  const a = current().find((x) => x.id === id);
  if (!a) throw new AppError('UNKNOWN_MARKETPLACE', 404, 'That marketplace is not supported.');
  return a;
}

/** In MARKETPLACE_ORDER. */
export function allAdapters(): AnyAdapter[] {
  return [...current()].sort((a, b) => MARKETPLACE_ORDER.indexOf(a.id) - MARKETPLACE_ORDER.indexOf(b.id));
}

/** Test-only: replace adapters (e.g. with scripted fakes). Pass `null` to restore the real list. */
export function __setAdaptersForTest(next: AnyAdapter[] | null): void {
  override = next;
}

setNoAutoSubmitProvider(() => current().filter((a) => !a.capabilities.autoSubmitAllowed).map((a) => a.id));
