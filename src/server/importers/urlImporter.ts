import type { MarketplaceAdapter } from '../marketplaces/types';
import type { MarketplaceImporter } from './types';

/** Placeholder replaced in M29 by the real generic URL importer (JSON-LD / OpenGraph). */
export function createUrlImporter(adapter: MarketplaceAdapter): MarketplaceImporter {
  return {
    methods: ['urls'],
    async fetch() { throw new Error(`${adapter.name}: URL import is not available yet`); },
    async downloadPhoto() { throw new Error('not available yet'); },
  };
}
