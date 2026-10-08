import { describe, expect, it } from 'vitest';
import { manualAdapter } from '../../../src/server/marketplaces/manual';
import { registerEtsyCheck } from './helpers';

describe('manual adapter', () => {
  const vinted = manualAdapter('vinted', 'Vinted', { home: 'https://www.vinted.com/', sell: 'https://www.vinted.com/items/new' });
  it('parses URLs only on its own host', () => {
    expect(vinted.parseListingUrl('https://www.vinted.com/items/123-nice-shirt')).toEqual({
      remoteId: '123-nice-shirt', url: 'https://www.vinted.com/items/123-nice-shirt',
    });
    expect(vinted.parseListingUrl('https://evil.com/items/1')).toBeNull();
    expect(vinted.parseListingUrl('not a url')).toBeNull();
    expect(manualAdapter('other', 'Other', { home: 'about:blank', sell: 'about:blank' }).parseListingUrl('https://x.com/a')).toBeNull();
  });
  it('has the specified capabilities', () => {
    expect(vinted.capabilities).toMatchObject({
      publish: 'manual', update: 'manual', deactivate: 'manual', statusCheck: 'none', import: 'url',
      autoSubmitAllowed: false, maxPhotos: 24, titleMaxLength: 100, descriptionMaxLength: 5000, minPriceCents: 100,
    });
    expect(vinted.kind).toBe('manual');
    expect(vinted.listingUrl('1')).toBe('https://www.vinted.com/');
  });
  it('warns on Etsy only', () => registerEtsyCheck());
});
