import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppTokenCache } from '../../../src/server/marketplaces/ebay/auth';
import { ebayImporter, htmlToText } from '../../../src/server/marketplaces/ebay/importer';
import { mapToCanonical } from '../../../src/server/importers/pipeline';
import { setSecret } from '../../../src/server/services/secrets';
import { createTestApp, type TestApp } from '../../helpers/testApp';
import { fixture, mockEbay } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });
beforeEach(async () => {
  resetAppTokenCache();
  await setSecret('ebay_access_token', JSON.stringify({ token: 'user-tok', expiresAt: Date.now() + 3_600_000 }));
  await setSecret('ebay_refresh_token', 'refresh-1');
});
afterEach(() => vi.restoreAllMocks());

const ctx = { throwIfCancelled: () => undefined, progress: vi.fn() } as never;

describe('eBay importer', () => {
  it('scans every page of active listings', async () => {
    const m = mockEbay({ 'trading:GetMyeBaySelling': (c) => (String(c.body).includes('<PageNumber>1</PageNumber>') ? fixture('getmyebayselling-1.xml') : fixture('getmyebayselling-2.xml')) });
    const items = await ebayImporter.scan!(ctx);
    expect(m.byKey('trading:GetMyeBaySelling')).toHaveLength(2);
    expect(items.map((i) => i.remoteId)).toEqual(['110000000001', '110000000002', '110000000003']);
    expect(items[0]).toMatchObject({ title: 'Levi 501 jeans', thumbUrl: 'https://i.ebayimg.com/a.jpg' });
    expect(items[0]!.url).toContain('110000000001');
    expect(items[1]!.thumbUrl).toBeNull();
  });

  it('fetches and maps a full item', async () => {
    mockEbay({ 'trading:GetItem': () => fixture('getitem-full.xml') });
    const imp = await ebayImporter.fetch(ctx, { remoteId: '110000000001', url: '' });
    expect(imp).toMatchObject({
      title: 'Levi 501 jeans', priceCents: 6500, conditionText: '3000', brand: "Levi's", size: '32', colorTexts: ['Blue', 'Black'],
      photoUrls: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg'], quantity: 1, status: 'active', extra: { SKU: 'CL-00007' },
    });
    expect(imp.categoryTexts).toEqual(['Clothing, Shoes & Accessories', 'Men', "Men's Clothing", 'Jeans']);
    expect(imp.description).toMatch(/^Classic jeans\.\n{1,2}Great shape\.$/);
    const p = mapToCanonical('ebay', imp);
    expect(p.condition).toBe('good');
    expect(p.colors).toEqual(['blue', 'black']);
  });

  it('htmlToText collapses blank lines', () => {
    expect(htmlToText('<p>a</p><br><br><br><br><p>b</p>')).not.toMatch(/\n{3}/);
  });
});
