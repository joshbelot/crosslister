import { expect } from 'vitest';
import { manualAdapter } from '../../../src/server/marketplaces/manual';
import type { EffectiveListing } from '../../../src/server/marketplaces/types';

export function registerEtsyCheck(): void {
  const etsy = manualAdapter('etsy', 'Etsy', { home: 'https://www.etsy.com/', sell: 'https://www.etsy.com/' });
  const other = manualAdapter('vinted', 'Vinted', { home: 'https://www.vinted.com/', sell: 'https://www.vinted.com/' });
  const eff = {} as EffectiveListing;
  expect(etsy.validate(eff)).toEqual([{ field: 'category', severity: 'warning', message: 'Etsy only allows handmade items, vintage items (20+ years old) and craft supplies.' }]);
  expect(other.validate(eff)).toEqual([]);
}
