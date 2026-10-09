import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/server/config';
import { ebayAdapter } from '../../../src/server/marketplaces/ebay';
import { clearRestCache } from '../../../src/server/marketplaces/ebay/rest';
import { resetAppTokenCache } from '../../../src/server/marketplaces/ebay/auth';
import { upsertConnection } from '../../../src/server/services/connections';
import { jobRunner } from '../../../src/server/services/jobRunner';
import { setSecret, deleteSecret, getSecret } from '../../../src/server/services/secrets';
import { waitFor } from '../../helpers/fakeAdapter';
import { seedListing } from '../../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../../helpers/testApp';
import { fixture, mockEbay, tokenJson } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });
beforeEach(async () => {
  clearRestCache(); resetAppTokenCache();
  await setSecret('ebay_access_token', JSON.stringify({ token: 'user-tok', expiresAt: Date.now() + 3_600_000 }));
  await setSecret('ebay_refresh_token', 'refresh-1');
  upsertConnection(t.db, 'ebay', { status: 'connected', accountName: 'testseller' });
  const s = (await req(t.app, 'GET', '/api/settings')).json();
  s.ebay = { fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1', postalCode: '94107', dispatchTimeDays: 1 };
  s.marketplaces.ebay.autoSubmit = true; s.marketplaces.ebay.dailyLimit = 200;
  await req(t.app, 'PUT', '/api/settings', s);
});
afterEach(async () => {
  await jobRunner.idle();
  vi.restoreAllMocks();
  const { jobs } = await import('../../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  t.db.update(jobs).set({ state: 'CANCELLED' }).where(eq(jobs.state, 'NOT_STARTED')).run();
});

const ASPECTS = JSON.stringify({ aspects: [
  { localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' }, aspectValues: [] },
  { localizedAspectName: 'Color', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'Blue' }, { localizedValue: 'Red' }] },
] });
const CONDITIONS = JSON.stringify({ itemConditionPolicies: [{ itemConditions: [{ conditionId: '1000', conditionDescription: 'New' }, { conditionId: '3000', conditionDescription: 'Used' }] }] });
const restBase = {
  'token:client_credentials': () => tokenJson({ access_token: 'app-1' }),
  'rest:/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category': () => ASPECTS,
  'rest:/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies': () => CONDITIONS,
};

async function listedReady(extra: Record<string, unknown> = {}, data: Record<string, unknown> = { categoryId: '11483', categoryName: 'Jeans', categoryAuto: false, requiredAspects: ['Brand'] }) {
  // keep background `prepare` away from the network
  mockEbay({ ...restBase, 'rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions': () => JSON.stringify({ categorySuggestions: [] }) });
  const l = await seedListing(t.app, { brand: "Levi's", ...extra });
  await req(t.app, 'PUT', `/api/listings/${l.id}/marketplaces`, { marketplaceIds: ['ebay'] });
  await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/ebay`, { data });
  vi.restoreAllMocks();
  return l;
}
const report = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}/validation?marketplaceIds=ebay`)).json().marketplaces[0];
const msgs = (r: { issues: Array<{ message: string }> }) => r.issues.map((i) => i.message);
const getJob = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();

describe('validation', () => {
  it('is ready when connected, policies are set, category and required aspects are covered', async () => {
    const l = await listedReady();
    const r = await report(l.id);
    expect(r.ready, JSON.stringify(r.issues)).toBe(true);
    expect(r.issues).toEqual([]);
  });
  it('reports setup problems', async () => {
    const l = await listedReady();
    upsertConnection(t.db, 'ebay', { status: 'logged_out' });
    expect(msgs(await report(l.id))).toContain('Connect eBay in Settings → Marketplaces.');
    const old = config.ebay.clientId; config.ebay.clientId = '';
    expect(msgs(await report(l.id))).toContain("eBay isn't set up yet. See docs/SETUP.md → Connect eBay.");
    config.ebay.clientId = old;
    upsertConnection(t.db, 'ebay', { status: 'connected' });
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.ebay.paymentPolicyId = null; s.ebay.postalCode = '';
    await req(t.app, 'PUT', '/api/settings', s);
    const m = msgs(await report(l.id));
    expect(m).toContain('Choose your eBay shipping, payment and return policies in Settings → Marketplaces → eBay.');
    expect(m).toContain('Add your ZIP code in Settings → Marketplaces → eBay.');
  });
  it('needs a category, warns on an automatic one, and demands required item specifics', async () => {
    const l = await listedReady({}, { requiredAspects: ['Material', 'Brand'] });
    expect(msgs(await report(l.id))).toContain('Choose an eBay category.');
    await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/ebay`, { data: { categoryId: '11483', categoryName: 'Clothing > Jeans', categoryAuto: true, requiredAspects: ['Material', 'Brand', 'Fabric Type'] } });
    const r = await report(l.id);
    expect(msgs(r)).toContain("eBay category chosen automatically: Clothing > Jeans. Change it if it's wrong.");
    expect(msgs(r)).toContain('eBay requires “Material” for this category.');
    expect(msgs(r)).toContain('eBay requires “Fabric Type” for this category.');
    expect(msgs(r)).not.toContain('eBay requires “Brand” for this category.'); // filled from the listing's brand
    expect(r.ready).toBe(false);
    await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/ebay`, { data: { categoryId: '11483', categoryName: 'Jeans', categoryAuto: false, requiredAspects: ['Material'], aspects: { Material: ['Denim'] } } });
    expect((await report(l.id)).ready).toBe(true);
  });
});

describe('prepare hook', () => {
  it('suggests a category and records the required aspects (also triggered by adding the target)', async () => {
    const suggestions = JSON.stringify({ categorySuggestions: [{ category: { categoryId: '11483', categoryName: 'Jeans' }, categoryTreeNodeAncestors: [{ categoryName: "Men's Clothing", categoryTreeNodeLevel: 1 }] }] });
    const m = mockEbay({ ...restBase, 'rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions': () => suggestions });
    const l = await seedListing(t.app, { brand: "Levi's" });
    await req(t.app, 'PUT', `/api/listings/${l.id}/marketplaces`, { marketplaceIds: ['ebay'] });
    const d = await waitFor(async () => { const x = (await req(t.app, 'GET', `/api/listings/${l.id}`)).json(); return x.marketplaces[0].data.categoryId ? x : null; });
    expect(d.marketplaces[0].data).toMatchObject({ categoryId: '11483', categoryName: "Men's Clothing > Jeans", categoryAuto: true, requiredAspects: ['Brand'] });
    expect(m.byKey('rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions')[0]!.url).toContain("q=Men's%20Jeans");
  });
  it('never throws: failures return an empty patch; a user-chosen category is left alone', async () => {
    mockEbay({ ...restBase, 'rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions': () => ({ status: 500, body: '{}' }) });
    const base = { id: 'x', sku: 'CL-1', categoryId: 'men.bottoms.jeans', title: 'T' } as never;
    expect(await ebayAdapter.prepare!(t.db, base, { data: {} } as never)).toEqual({});
    vi.restoreAllMocks();
    const m = mockEbay({});
    expect(await ebayAdapter.prepare!(t.db, base, { data: { categoryAuto: false } } as never)).toEqual({});
    expect(m.calls).toHaveLength(0);
  });
});

describe('publish', () => {
  const tradingMocks = (over: Record<string, () => string> = {}) => ({
    ...restBase,
    'trading:UploadSiteHostedPictures': () => fixture('upload-success.xml'),
    'trading:VerifyAddFixedPriceItem': () => fixture('verify-success.xml'),
    'trading:AddFixedPriceItem': () => fixture('add-success.xml'),
    ...over,
  });

  it('uploads pictures, verifies, then adds the listing (autoSubmit on)', async () => {
    const l = await listedReady({ title: 'Levi 501 <Jeans>', description: 'Nice & clean', conditionNotes: 'Tiny stain' });
    const m = mockEbay(tradingMocks());
    const { jobs } = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['ebay'] })).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(jobs[0].id);
    expect(j.state, j.errorMessage).toBe('SUCCESS');
    expect(j.result).toEqual({ remoteId: '110123456789', url: 'https://www.ebay.com/itm/110123456789', verified: true });
    expect(j.steps.map((s: { key: string }) => s.key)).toEqual(['photos', 'auth', 'condition', 'aspects', 'photos', 'verify', 'publish']);
    expect(m.calls.map((c) => c.key).filter((k) => k.startsWith('trading:'))).toEqual(['trading:UploadSiteHostedPictures', 'trading:VerifyAddFixedPriceItem', 'trading:AddFixedPriceItem']);
    const verifyBody = String(m.byKey('trading:VerifyAddFixedPriceItem')[0]!.body);
    expect(verifyBody).toContain('<ConditionID>3000</ConditionID>');
    expect(verifyBody).toContain('<ConditionDescription>Tiny stain</ConditionDescription>');
    expect(verifyBody).toContain('<Title>Levi 501 &lt;Jeans&gt;</Title>');
    expect(verifyBody).toContain('<CategoryID>11483</CategoryID>');
    expect(verifyBody).toContain('<PictureURL>https://i.ebayimg.com/00/s/test-01.jpg</PictureURL>');
    expect(verifyBody).toContain('<NameValueList><Name>Brand</Name><Value>Levi&apos;s</Value></NameValueList>');
    expect(verifyBody).toContain('<NameValueList><Name>Color</Name><Value>Blue</Value></NameValueList>');
    expect(verifyBody).toContain('<ShippingProfileID>F1</ShippingProfileID>');
    expect(verifyBody).toContain('<WeightMajor unit="lbs">1</WeightMajor>');
    const upload = m.byKey('trading:UploadSiteHostedPictures')[0]!.body as FormData;
    expect(String(upload.get('XML Payload'))).toContain('<PictureName>');
    expect(upload.get('image')).toBeInstanceOf(Blob);
    const d = (await req(t.app, 'GET', `/api/listings/${l.id}`)).json();
    expect(d.marketplaces[0]).toMatchObject({ status: 'active', remoteId: '110123456789', verified: true });
  });

  it('with autoSubmit off it pauses before AddFixedPriceItem and shows the fee estimate', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.marketplaces.ebay.autoSubmit = false;
    await req(t.app, 'PUT', '/api/settings', s);
    const l = await listedReady();
    const m = mockEbay(tradingMocks());
    const { jobs } = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['ebay'] })).json();
    const run = jobRunner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await getJob(jobs[0].id); return j.state === 'NEEDS_USER' ? j : null; });
    expect(waiting.needsUser).toMatchObject({ title: 'Ready to publish on eBay', primaryAction: 'Publish now' });
    expect(waiting.needsUser.instructions).toContain('$0.85');
    expect(m.byKey('trading:AddFixedPriceItem')).toHaveLength(0);
    await req(t.app, 'POST', `/api/jobs/${jobs[0].id}/continue`, {});
    await run;
    expect(m.byKey('trading:AddFixedPriceItem')).toHaveLength(1);
    expect((await getJob(jobs[0].id)).state).toBe('SUCCESS');
  });

  it('API failures fail the job with eBay\'s message and never mark the item listed', async () => {
    const l = await listedReady();
    mockEbay(tradingMocks({ 'trading:AddFixedPriceItem': () => fixture('failure.xml') }));
    const { jobs } = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['ebay'] })).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(jobs[0].id);
    expect(j.state).toBe('FAILED');
    expect(j.errorCode).toBe('API_ERROR');
    expect(j.errorMessage).toContain('The category is not valid for this item.');
    const d = (await req(t.app, 'GET', `/api/listings/${l.id}`)).json();
    expect(d.marketplaces[0].status).toBe('error');
    expect(d.status).not.toBe('listed');
  });

  it('fails clearly when the category has no matching condition', async () => {
    const l = await listedReady({ condition: 'like_new' });
    mockEbay(tradingMocks({ 'rest:/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies': () => JSON.stringify({ itemConditionPolicies: [{ itemConditions: [{ conditionId: '1000', conditionDescription: 'New' }] }] }) }));
    const { jobs } = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['ebay'] })).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(jobs[0].id);
    expect(j.state).toBe('FAILED');
    expect(j.errorMessage).toContain('eBay has no matching condition for this category');
  });
});

describe('update, end listing and status', () => {
  async function activeListing() {
    const l = await listedReady();
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/mark-listed`, { url: 'https://www.ebay.com/itm/110123456789' });
    return l;
  }

  it('revises title, description and price only', async () => {
    const l = await activeListing();
    await req(t.app, 'PATCH', `/api/listings/${l.id}`, { title: 'New title', priceCents: 7000 });
    const m = mockEbay({ 'trading:ReviseFixedPriceItem': () => fixture('partial-warning-only.xml') });
    const { job } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/update`)).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(job.id)).state).toBe('SUCCESS');
    const body = String(m.byKey('trading:ReviseFixedPriceItem')[0]!.body);
    expect(body).toContain('<ItemID>110123456789</ItemID>');
    expect(body).toContain('<Title>New title</Title>');
    expect(body).toContain('<StartPrice currencyID="USD">70.00</StartPrice>');
    expect(body).not.toContain('PictureDetails');
    expect(body).not.toContain('<Quantity>');
  });

  it('ends the listing (autoSubmit on); error 1047 counts as success', async () => {
    const l = await activeListing();
    const m = mockEbay({ 'trading:EndFixedPriceItem': () => fixture('end-success.xml') });
    const { job } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/deactivate`)).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(job.id)).state).toBe('SUCCESS');
    expect(String(m.calls[0]!.body)).toContain('<EndingReason>NotAvailable</EndingReason>');
    expect((await req(t.app, 'GET', `/api/listings/${l.id}`)).json().marketplaces[0].status).toBe('ended');

    vi.restoreAllMocks();
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/mark-listed`, { url: 'https://www.ebay.com/itm/110123456789' });
    mockEbay({ 'trading:EndFixedPriceItem': () => fixture('end-1047.xml') });
    const { job: j2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/deactivate`)).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(j2.id)).state).toBe('SUCCESS');
  });

  it('asks before ending when autoSubmit is off', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.marketplaces.ebay.autoSubmit = false;
    await req(t.app, 'PUT', '/api/settings', s);
    const l = await activeListing();
    const m = mockEbay({ 'trading:EndFixedPriceItem': () => fixture('end-success.xml') });
    const { job } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/ebay/deactivate`)).json();
    const run = jobRunner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await getJob(job.id); return j.state === 'NEEDS_USER' ? j : null; });
    expect(waiting.needsUser).toMatchObject({ reason: 'confirm_delete', title: 'End eBay listing', primaryAction: 'End listing' });
    expect(m.calls).toHaveLength(0);
    await req(t.app, 'POST', `/api/jobs/${job.id}/continue`, {});
    await run;
    expect(m.calls).toHaveLength(1);
  });

  it('checkStatus maps eBay listing states', async () => {
    const ml = { remoteId: '110123456789' } as never;
    for (const [file, expected] of [['getitem-active.xml', 'active'], ['getitem-sold.xml', 'sold'], ['getitem-ended.xml', 'ended']] as const) {
      mockEbay({ 'trading:GetItem': () => fixture(file) });
      expect(await ebayAdapter.checkStatus!({} as never, ml)).toBe(expected);
      vi.restoreAllMocks();
    }
  });
});

describe('connect and OAuth callback', () => {
  const connectMocks = () => mockEbay({
    'token:authorization_code': () => tokenJson(),
    'trading:GetUser': () => fixture('getuser.xml'),
  });

  it('is not_configured without credentials', async () => {
    const old = config.ebay.ruName; config.ebay.ruName = '';
    const { job } = (await req(t.app, 'POST', '/api/marketplaces/ebay/connect')).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(job.id)).result).toMatchObject({ status: 'not_configured' });
    expect((await req(t.app, 'GET', '/api/marketplaces')).json().find((m: { id: string }) => m.id === 'ebay').connection.status).toBe('not_configured');
    expect((await req(t.app, 'GET', '/api/marketplaces/ebay/status')).json()).toMatchObject({ configured: false, missing: ['EBAY_RUNAME'] });
    config.ebay.ruName = old;
  });

  it('the callback route resumes the waiting connect job', async () => {
    await deleteSecret('ebay_refresh_token'); await deleteSecret('ebay_access_token');
    const m = connectMocks();
    const { job } = (await req(t.app, 'POST', '/api/marketplaces/ebay/connect')).json();
    const run = jobRunner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await getJob(job.id); return j.state === 'NEEDS_USER' ? j : null; });
    expect(waiting.needsUser.title).toBe('Connect eBay');
    const link = new URL(waiting.needsUser.link.url);
    const state = link.searchParams.get('state')!;
    expect(state).toHaveLength(24);
    expect(link.searchParams.get('redirect_uri')).toBe('Test-RuName-123');

    const bad = await req(t.app, 'GET', '/api/marketplaces/ebay/oauth/callback?code=zzz&state=wrong');
    expect(bad.body).toContain('No pending eBay connection.');
    const ok = await req(t.app, 'GET', `/api/marketplaces/ebay/oauth/callback?code=abc123&state=${state}`);
    expect(ok.body).toContain('eBay is connected');
    await run;
    const done = await getJob(job.id);
    expect(done.state, done.errorMessage).toBe('SUCCESS');
    expect(m.byKey('token:authorization_code')[0]!.body).toMatchObject({ code: 'abc123' });
    expect(await getSecret('ebay_refresh_token')).toBe('refresh-1');
    const conn = (await req(t.app, 'GET', '/api/marketplaces')).json().find((x: { id: string }) => x.id === 'ebay').connection;
    expect(conn).toMatchObject({ status: 'connected', accountName: 'testseller' });
  });

  it('accepts a pasted address and checks the state; a missing code fails clearly', async () => {
    connectMocks();
    let { job } = (await req(t.app, 'POST', '/api/marketplaces/ebay/connect')).json();
    let run = jobRunner.runOnce(t.db);
    let waiting = await waitFor(async () => { const j = await getJob(job.id); return j.state === 'NEEDS_USER' ? j : null; });
    let state = new URL(waiting.needsUser.link.url).searchParams.get('state');
    await req(t.app, 'POST', `/api/jobs/${job.id}/continue`, { url: `https://example.com/accepted?code=pasted-code&state=${state}` });
    await run;
    expect((await getJob(job.id)).state).toBe('SUCCESS');

    ({ job } = (await req(t.app, 'POST', '/api/marketplaces/ebay/connect')).json());
    run = jobRunner.runOnce(t.db);
    waiting = await waitFor(async () => { const j = await getJob(job.id); return j.state === 'NEEDS_USER' ? j : null; });
    await req(t.app, 'POST', `/api/jobs/${job.id}/continue`, { url: 'https://example.com/accepted?nothing=here' });
    await run;
    const failed = await getJob(job.id);
    expect(failed.state).toBe('FAILED');
    expect(failed.errorMessage).toContain('No authorization code found in that address.');

    ({ job } = (await req(t.app, 'POST', '/api/marketplaces/ebay/connect')).json());
    run = jobRunner.runOnce(t.db);
    waiting = await waitFor(async () => { const j = await getJob(job.id); return j.state === 'NEEDS_USER' ? j : null; });
    state = 'other';
    await req(t.app, 'POST', `/api/jobs/${job.id}/continue`, { url: `https://example.com/accepted?code=c&state=${state}` });
    await run;
    expect((await getJob(job.id)).errorMessage).toContain('different request');
  });

  it('disconnect deletes the stored eBay tokens', async () => {
    const info = (await req(t.app, 'POST', '/api/marketplaces/ebay/disconnect')).json();
    expect(info.connection.status).toBe('logged_out');
    expect(await getSecret('ebay_refresh_token')).toBeNull();
    expect(await getSecret('ebay_access_token')).toBeNull();
  });
});
