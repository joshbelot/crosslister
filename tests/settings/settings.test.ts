import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

describe('settings', () => {
  it('returns defaults', async () => {
    const res = await req(t.app, 'GET', '/api/settings');
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.marketplaces.ebay.autoSubmit).toBe(true);
    expect(s.defaultMarketplaces).toEqual(['mercari', 'poshmark', 'depop', 'facebook']);
  });
  it('saves, forces facebook autoSubmit off, and persists', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.descriptionFooter = 'Thanks!';
    s.marketplaces.facebook.autoSubmit = true;
    s.marketplaces.mercari.priceAdjustPercent = 10;
    const res = await req(t.app, 'PUT', '/api/settings', s);
    expect(res.statusCode).toBe(200);
    expect(res.json().marketplaces.facebook.autoSubmit).toBe(false);
    const again = (await req(t.app, 'GET', '/api/settings')).json();
    expect(again.descriptionFooter).toBe('Thanks!');
    expect(again.marketplaces.mercari.priceAdjustPercent).toBe(10);
  });
  it('validates input', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.ebay.postalCode = 'abc';
    let res = await req(t.app, 'PUT', '/api/settings', s);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    s.ebay.postalCode = '94107';
    s.marketplaces.depop.dailyLimit = 0;
    res = await req(t.app, 'PUT', '/api/settings', s);
    expect(res.statusCode).toBe(400);
  });
  it('merges stored values over defaults and drops unknown keys', async () => {
    const { setKv } = await import('../../src/server/services/settings');
    setKv(t.db, 'app', { descriptionFooter: 'hi', bogus: 1, browser: { slowMoMs: 50 } });
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    expect(s.descriptionFooter).toBe('hi');
    expect(s.browser).toEqual({ channel: 'chrome', slowMoMs: 50, closeIdleMinutes: 20 });
    expect(s.bogus).toBeUndefined();
  });
  it('serves recent kv', async () => {
    const res = await req(t.app, 'GET', '/api/settings/kv/recent');
    expect(res.json()).toEqual({ recentCategories: [], lastMarketplaces: [], brands: [] });
  });
});
