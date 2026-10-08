import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

export const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

export interface MockCall { key: string; url: string; headers: Record<string, string>; body: unknown }
export interface MockReply { status?: number; body: string }
type Handler = (call: MockCall) => MockReply | string;

/**
 * Mocks `fetch` for every eBay endpoint. Keys: `trading:<Call>`, `token:<grant_type>`, `rest:<pathname>`.
 * Unhandled requests throw so a test can never reach the network.
 */
export function mockEbay(handlers: Record<string, Handler>) {
  const calls: MockCall[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let key: string;
    let body: unknown = init?.body;
    if (url.includes('/ws/api.dll')) key = `trading:${headers['X-EBAY-API-CALL-NAME']}`;
    else if (url.includes('/identity/v1/oauth2/token')) {
      const params = new URLSearchParams(String(init?.body ?? ''));
      body = Object.fromEntries(params);
      key = `token:${params.get('grant_type')}`;
    } else key = `rest:${new URL(url).pathname}`;
    const call = { key, url, headers, body };
    calls.push(call);
    const h = handlers[key];
    if (!h) throw new Error(`Unexpected request in test: ${key} (${url})`);
    const r = h(call);
    const reply = typeof r === 'string' ? { body: r } : r;
    return new Response(reply.body, { status: reply.status ?? 200 });
  });
  return { calls, spy, byKey: (k: string) => calls.filter((c) => c.key === k) };
}

export const tokenJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7200, ...extra });
