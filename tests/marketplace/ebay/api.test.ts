import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/server/config';
import { buildAuthorizeUrl, exchangeCode, getAppToken, getUserAccessToken, isConfigured, missingConfig, resetAppTokenCache } from '../../../src/server/marketplaces/ebay/auth';
import { tradingCall, EbayTradingError } from '../../../src/server/marketplaces/ebay/trading';
import { clearRestCache, getAspects, getConditions, getPolicies, suggestCategories } from '../../../src/server/marketplaces/ebay/rest';
import { deleteSecret, getSecret, setSecret } from '../../../src/server/services/secrets';
import { ensureDirs } from '../../../src/server/paths';
import { fixture, mockEbay, tokenJson } from './helpers';

beforeAll(() => ensureDirs());
beforeEach(async () => {
  await deleteSecret('ebay_access_token'); await deleteSecret('ebay_refresh_token'); resetAppTokenCache(); clearRestCache();
});
afterEach(() => vi.restoreAllMocks());

describe('auth', () => {
  it('reports configuration', () => {
    expect(isConfigured()).toBe(true);
    const old = config.ebay.clientSecret;
    config.ebay.clientSecret = '';
    expect(isConfigured()).toBe(false);
    expect(missingConfig()).toEqual(['EBAY_CLIENT_SECRET']);
    config.ebay.clientSecret = old;
  });
  it('builds the authorize URL', () => {
    const u = new URL(buildAuthorizeUrl('st8'));
    expect(u.origin + u.pathname).toBe('https://auth.ebay.com/oauth2/authorize');
    expect(u.searchParams.get('client_id')).toBe('test-client-id');
    expect(u.searchParams.get('redirect_uri')).toBe('Test-RuName-123');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('st8');
    expect(u.searchParams.get('scope')).toContain('sell.inventory');
  });
  it('exchanges the code and stores tokens', async () => {
    const m = mockEbay({ 'token:authorization_code': () => tokenJson() });
    await exchangeCode('the-code');
    const call = m.calls[0]!;
    expect(call.body).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'Test-RuName-123' });
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`);
    expect(await getSecret('ebay_refresh_token')).toBe('refresh-1');
    expect(JSON.parse((await getSecret('ebay_access_token'))!).token).toBe('access-1');
  });
  it('caches the user access token and refreshes when it is about to expire', async () => {
    const m = mockEbay({ 'token:refresh_token': () => tokenJson({ access_token: 'access-2' }) });
    await setSecret('ebay_refresh_token', 'refresh-1');
    await setSecret('ebay_access_token', JSON.stringify({ token: 'cached', expiresAt: Date.now() + 3_600_000 }));
    expect(await getUserAccessToken()).toBe('cached');
    expect(m.calls).toHaveLength(0);
    await setSecret('ebay_access_token', JSON.stringify({ token: 'old', expiresAt: Date.now() + 60_000 }));
    expect(await getUserAccessToken()).toBe('access-2');
    expect(await getUserAccessToken()).toBe('access-2');
    expect(m.byKey('token:refresh_token')).toHaveLength(1);
    expect(m.calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
  });
  it('invalid_grant clears the secrets and reports NOT_CONNECTED', async () => {
    mockEbay({ 'token:refresh_token': () => ({ status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }) }) });
    await setSecret('ebay_refresh_token', 'refresh-1');
    const err = await getUserAccessToken().catch((e) => e);
    expect(err.code).toBe('NOT_CONNECTED');
    expect(err.userMessage).toBe('eBay sign-in expired. Reconnect eBay in Settings.');
    expect(await getSecret('ebay_refresh_token')).toBeNull();
  });
  it('without a refresh token the user is not connected', async () => {
    expect((await getUserAccessToken().catch((e) => e)).code).toBe('NOT_CONNECTED');
  });
  it('other token errors become API_ERROR with eBay\'s description; the app token is cached', async () => {
    mockEbay({ 'token:authorization_code': () => ({ status: 400, body: JSON.stringify({ error: 'invalid_request', error_description: 'bad code' }) }) });
    const err = await exchangeCode('x').catch((e) => e);
    expect(err.code).toBe('API_ERROR');
    expect(err.userMessage).toBe('eBay returned an error: bad code');
    vi.restoreAllMocks();
    const m = mockEbay({ 'token:client_credentials': () => tokenJson({ access_token: 'app-1' }) });
    expect(await getAppToken()).toBe('app-1');
    expect(await getAppToken()).toBe('app-1');
    expect(m.byKey('token:client_credentials')).toHaveLength(1);
  });
});

describe('trading client', () => {
  beforeEach(async () => { await setSecret('ebay_access_token', JSON.stringify({ token: 'user-tok', expiresAt: Date.now() + 3_600_000 })); });

  it('sends the right headers and body and returns the parsed response', async () => {
    const m = mockEbay({ 'trading:AddFixedPriceItem': () => fixture('add-success.xml') });
    const res = await tradingCall<{ ItemID: number; Fees: { Fee: unknown[] } }>('AddFixedPriceItem', '<Item><Title>x</Title></Item>');
    expect(String(res.ItemID)).toBe('110123456789');
    expect(res.Fees.Fee).toHaveLength(2);
    const call = m.calls[0]!;
    expect(call.url).toBe('https://api.ebay.com/ws/api.dll');
    expect(call.headers).toMatchObject({
      'X-EBAY-API-CALL-NAME': 'AddFixedPriceItem', 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1349',
      'X-EBAY-API-IAF-TOKEN': 'user-tok', 'Content-Type': 'text/xml',
    });
    expect(call.body).toBe('<?xml version="1.0" encoding="utf-8"?><AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><Title>x</Title></Item><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel></AddFixedPriceItemRequest>');
  });
  it('turns Failure into an API_ERROR carrying every long message and the error codes', async () => {
    mockEbay({ 'trading:AddFixedPriceItem': () => fixture('failure.xml') });
    const err = await tradingCall('AddFixedPriceItem', '').catch((e) => e);
    expect(err).toBeInstanceOf(EbayTradingError);
    expect(err.code).toBe('API_ERROR');
    expect(err.userMessage).toBe('eBay returned an error: The category is not valid for this item. The item specific Brand is missing.');
    expect(err.codes).toEqual(['87', '21919303']);
  });
  it('treats warnings as success but PartialFailure with an error as failure', async () => {
    mockEbay({ 'trading:ReviseFixedPriceItem': () => fixture('partial-warning-only.xml'), 'trading:VerifyAddFixedPriceItem': () => fixture('verify-success.xml') });
    await expect(tradingCall('ReviseFixedPriceItem', '')).resolves.toBeDefined();
    await expect(tradingCall('VerifyAddFixedPriceItem', '')).resolves.toBeDefined();
    vi.restoreAllMocks();
    const partialError = fixture('partial-warning-only.xml').replace('Warning</SeverityCode>', 'Error</SeverityCode>');
    mockEbay({ 'trading:ReviseFixedPriceItem': () => partialError });
    expect((await tradingCall('ReviseFixedPriceItem', '').catch((e) => e)).userMessage).toContain('This is only a warning.');
  });
  it('rejects garbage responses', async () => {
    mockEbay({ 'trading:GetUser': () => '<html>nope</html>' });
    expect((await tradingCall('GetUser', '').catch((e) => e)).code).toBe('API_ERROR');
  });
});

describe('rest client', () => {
  beforeEach(async () => { await setSecret('ebay_access_token', JSON.stringify({ token: 'user-tok', expiresAt: Date.now() + 3_600_000 })); });
  const appToken = { 'token:client_credentials': () => tokenJson({ access_token: 'app-1' }) };

  it('suggests categories with their paths (cached)', async () => {
    const m = mockEbay({ ...appToken, 'rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions': () => JSON.stringify({
      categorySuggestions: [{ category: { categoryId: '11483', categoryName: 'Jeans' }, categoryTreeNodeAncestors: [
        { categoryName: "Men's Clothing", categoryTreeNodeLevel: 2 }, { categoryName: 'Clothing, Shoes & Accessories', categoryTreeNodeLevel: 1 }] }] }) });
    expect(await suggestCategories("Men's Jeans")).toEqual([{ categoryId: '11483', name: 'Jeans', path: "Clothing, Shoes & Accessories > Men's Clothing > Jeans" }]);
    await suggestCategories("Men's Jeans");
    expect(m.byKey('rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions')).toHaveLength(1);
    expect(m.byKey('rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions')[0]!.headers.Authorization).toBe('Bearer app-1');
  });
  it('reads aspects, conditions and policies', async () => {
    mockEbay({
      ...appToken,
      'rest:/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category': () => JSON.stringify({ aspects: [
        { localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' }, aspectValues: [{ localizedValue: 'Nike' }] },
        { localizedAspectName: 'Color', aspectConstraint: { aspectMode: 'SELECTION_ONLY', itemToAspectCardinality: 'MULTI' }, aspectValues: [{ localizedValue: 'Blue' }] }] }),
      'rest:/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies': () => JSON.stringify({ itemConditionPolicies: [{ itemConditions: [
        { conditionId: '1000', conditionDescription: 'New' }, { conditionId: '3000', conditionDescription: 'Used' }] }] }),
      'rest:/sell/account/v1/fulfillment_policy': () => JSON.stringify({ fulfillmentPolicies: [{ fulfillmentPolicyId: 'F1', name: 'Ship' }] }),
      'rest:/sell/account/v1/payment_policy': () => JSON.stringify({ paymentPolicies: [{ paymentPolicyId: 'P1', name: 'Pay' }] }),
      'rest:/sell/account/v1/return_policy': () => JSON.stringify({ returnPolicies: [{ returnPolicyId: 'R1', name: 'Return' }] }),
    });
    expect(await getAspects('11483')).toEqual([
      { name: 'Brand', required: true, mode: 'FREE_TEXT', multi: false, values: ['Nike'] },
      { name: 'Color', required: false, mode: 'SELECTION_ONLY', multi: true, values: ['Blue'] },
    ]);
    expect(await getConditions('11483')).toEqual([{ conditionId: 1000, label: 'New' }, { conditionId: 3000, label: 'Used' }]);
    expect(await getPolicies()).toEqual({ fulfillment: [{ id: 'F1', name: 'Ship' }], payment: [{ id: 'P1', name: 'Pay' }], return: [{ id: 'R1', name: 'Return' }] });
  });
  it('surfaces REST errors', async () => {
    mockEbay({ ...appToken, 'rest:/commerce/taxonomy/v1/category_tree/0/get_category_suggestions': () => ({ status: 500, body: JSON.stringify({ errors: [{ message: 'Boom' }] }) }) });
    const err = await suggestCategories('x').catch((e) => e);
    expect(err.userMessage).toBe('eBay returned an error: Boom');
  });
});
