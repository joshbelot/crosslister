import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

describe('security hook', () => {
  it('serves health to an allowed host', async () => {
    const res = await req(t.app, 'GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
  it('rejects a foreign Host', async () => {
    const res = await req(t.app, 'GET', '/api/health', undefined, { host: 'evil.example.com' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_HOST');
  });
  it('rejects a foreign Origin on mutating requests', async () => {
    const res = await req(t.app, 'POST', '/api/system/open-folder', { which: 'logs' }, { origin: 'https://evil.example.com' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_ORIGIN');
  });
  it('requires the X-Crosslister header on mutating requests', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/system/open-folder', headers: { host: '127.0.0.1:4317' }, payload: { which: 'logs' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('MISSING_HEADER');
  });
  it('maps zod errors to 400 VALIDATION', async () => {
    const res = await req(t.app, 'POST', '/api/system/open-folder', { which: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('logger', () => {
  it('writes to the DB, the daily file, redacts secrets, and serves /api/logs', async () => {
    const { logger } = await import('../../src/server/services/logger');
    logger.info('POSHMARK', 'Uploading 6 photos', { jobId: 'j1', listingId: 'l1', marketplaceId: 'poshmark', data: { token: 'abc', nested: { apiKey: 'x', ok: 1 } } });
    logger.debug('SERVER', 'debug only in file');
    const res = await req(t.app, 'GET', '/api/logs?level=info&marketplaceId=poshmark');
    const items = res.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].data).toEqual({ token: '[redacted]', nested: { apiKey: '[redacted]', ok: 1 } });
    const all = (await req(t.app, 'GET', '/api/logs?level=debug')).json().items;
    expect(all.some((e: { message: string }) => e.message.includes('debug only'))).toBe(false);
    const { paths } = await import('../../src/server/paths');
    await new Promise((r) => setTimeout(r, 50));
    const files = fs.readdirSync(paths.logsDir);
    expect(files.some((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))).toBe(true);
    const text = fs.readFileSync(path.join(paths.logsDir, files[0]!), 'utf8');
    expect(text).toMatch(/INFO {2}\[POSHMARK\] Uploading 6 photos {2}\(job=j1 listing=l1\)/);
  });
});
