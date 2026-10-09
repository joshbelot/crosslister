import { config } from '../../config';
import { adapterError, AdapterError } from '../adapterError';
import { deleteSecret, getSecret, setSecret } from '../../services/secrets';

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
];

export function ebayHosts() {
  const sandbox = config.ebay.env === 'sandbox';
  return {
    authorize: sandbox ? 'https://auth.sandbox.ebay.com/oauth2/authorize' : 'https://auth.ebay.com/oauth2/authorize',
    rest: sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com',
    trading: sandbox ? 'https://api.sandbox.ebay.com/ws/api.dll' : 'https://api.ebay.com/ws/api.dll',
    itemPage: (id: string) => `${sandbox ? 'https://sandbox.ebay.com' : 'https://www.ebay.com'}/itm/${id}`,
    home: sandbox ? 'https://sandbox.ebay.com/' : 'https://www.ebay.com/',
  };
}

export function missingConfig(): string[] {
  const c = config.ebay;
  return [['EBAY_CLIENT_ID', c.clientId], ['EBAY_CLIENT_SECRET', c.clientSecret], ['EBAY_RUNAME', c.ruName]].filter(([, v]) => !v).map(([k]) => k as string);
}
export const isConfigured = (): boolean => missingConfig().length === 0;

export function buildAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: config.ebay.clientId, redirect_uri: config.ebay.ruName, response_type: 'code', scope: EBAY_SCOPES.join(' '), state,
  });
  return `${ebayHosts().authorize}?${q.toString().replace(/\+/g, '%20')}`;
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(`${config.ebay.clientId}:${config.ebay.clientSecret}`).toString('base64');
  const res = await fetch(`${ebayHosts().rest}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (json.error === 'invalid_grant' && body.grant_type === 'refresh_token') {
      await deleteSecret('ebay_refresh_token');
      await deleteSecret('ebay_access_token');
      throw new AdapterError('NOT_CONNECTED', 'eBay sign-in expired. Reconnect eBay in Settings.');
    }
    throw adapterError('API_ERROR', 'eBay', { detail: json.error_description ?? json.error ?? `HTTP ${res.status}` });
  }
  return json;
}

async function storeAccess(token: string, expiresInSec: number): Promise<void> {
  await setSecret('ebay_access_token', JSON.stringify({ token, expiresAt: Date.now() + expiresInSec * 1000 }));
}

export async function exchangeCode(code: string): Promise<void> {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.ebay.ruName });
  if (!t.refresh_token || !t.access_token) throw adapterError('API_ERROR', 'eBay', { detail: 'eBay did not return a token.' });
  await setSecret('ebay_refresh_token', t.refresh_token);
  await storeAccess(t.access_token, t.expires_in ?? 7200);
}

export async function getUserAccessToken(): Promise<string> {
  const cached = await getSecret('ebay_access_token');
  if (cached) {
    try {
      const { token, expiresAt } = JSON.parse(cached) as { token: string; expiresAt: number };
      if (expiresAt - Date.now() > 5 * 60_000) return token;
    } catch { /* fall through to refresh */ }
  }
  const refresh = await getSecret('ebay_refresh_token');
  if (!refresh) throw adapterError('NOT_CONNECTED', 'eBay');
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, scope: EBAY_SCOPES.join(' ') });
  if (!t.access_token) throw adapterError('API_ERROR', 'eBay', { detail: 'eBay did not return a token.' });
  await storeAccess(t.access_token, t.expires_in ?? 7200);
  return t.access_token;
}

let appToken: { token: string; expiresAt: number } | null = null;
export async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt - Date.now() > 5 * 60_000) return appToken.token;
  const t = await tokenRequest({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' });
  if (!t.access_token) throw adapterError('API_ERROR', 'eBay', { detail: 'eBay did not return a token.' });
  appToken = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000 };
  return appToken.token;
}
export function resetAppTokenCache(): void { appToken = null; }

export async function hasUserToken(): Promise<boolean> {
  return Boolean(await getSecret('ebay_refresh_token'));
}

export async function disconnect(): Promise<void> {
  await deleteSecret('ebay_refresh_token');
  await deleteSecret('ebay_access_token');
  appToken = null;
}
