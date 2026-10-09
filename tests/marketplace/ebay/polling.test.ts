import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetAppTokenCache } from '../../../src/server/marketplaces/ebay/auth';
import { jobs, marketplaceListings } from '../../../src/server/db/schema';
import { pollEbay } from '../../../src/server/services/statusChecks';
import { jobRunner } from '../../../src/server/services/jobRunner';
import { setSecret } from '../../../src/server/services/secrets';
import { setKv } from '../../../src/server/services/settings';
import { seedListing } from '../../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../../helpers/testApp';
import { fixture, mockEbay } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });
beforeEach(async () => {
  resetAppTokenCache();
  await setSecret('ebay_access_token', JSON.stringify({ token: 'user-tok', expiresAt: Date.now() + 3_600_000 }));
  await setSecret('ebay_refresh_token', 'refresh-1');
  setKv(t.db, 'ebay_last_poll', 0);
  t.db.delete(jobs).run();
  t.db.delete(marketplaceListings).run();
  await setPolling(true);
});
afterEach(async () => { await jobRunner.idle(); vi.restoreAllMocks(); });

async function setPolling(on: boolean) {
  const s = (await req(t.app, 'GET', '/api/settings')).json();
  s.statusChecks = { ebayPollingEnabled: on, ebayIntervalMinutes: 30 };
  await req(t.app, 'PUT', '/api/settings', s);
}
async function listActive(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const remote = `1100000000${String(i).padStart(2, '0')}`;
    const l = await seedListing(t.app, { title: `Item ${i}` });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/mark-listed`, { url: `https://www.ebay.com/itm/${remote}` });
    ids.push(l.id);
  }
  return ids;
}

describe('eBay polling', () => {
  it('does nothing when disabled or when the interval has not elapsed', async () => {
    await listActive(1);
    await setPolling(false);
    expect((await pollEbay(t.db)).ran).toBe(false);
    await setPolling(true);
    setKv(t.db, 'ebay_last_poll', Date.now());
    expect((await pollEbay(t.db)).ran).toBe(false);
  });

  it('creates one status_check job per listing when 5 or fewer are active', async () => {
    await listActive(3);
    const r = await pollEbay(t.db);
    expect(r).toMatchObject({ ran: true, jobs: 3 });
    expect((await pollEbay(t.db, Date.now() + 31 * 60_000)).ran).toBe(false); // previous checks still pending
    const m = mockEbay({ 'trading:GetItem': () => fixture('getitem-sold.xml') });
    await jobRunner.runOnce(t.db);
    expect(m.byKey('trading:GetItem')).toHaveLength(3);
  });

  it('uses a single SoldList call when more than 5 are active and flags only matching items', async () => {
    const ids = await listActive(7);
    const m = mockEbay({
      'trading:GetMyeBaySelling': () => '<?xml version="1.0"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><SoldList><OrderTransactionArray><OrderTransaction><Transaction><Item><ItemID>110000000002</ItemID></Item></Transaction></OrderTransaction></OrderTransactionArray></SoldList></GetMyeBaySellingResponse>',
    });
    const r = await pollEbay(t.db);
    expect(r).toMatchObject({ ran: true, jobs: 0, sold: 1 });
    expect(m.calls).toHaveLength(1);
    expect(String(m.calls[0]!.body)).toContain('<SoldList>');
    const flagged: string[] = [];
    for (const id of ids) {
      const d = (await req(t.app, 'GET', `/api/listings/${id}`)).json();
      if (d.saleDetectedMarketplaceId === 'ebay') flagged.push(d.title);
    }
    expect(flagged).toEqual(['Item 2']);
  });
});
