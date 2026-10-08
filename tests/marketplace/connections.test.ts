import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';

let t: TestApp;
const real = allAdapters();
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });

describe('disconnect', () => {
  it('manual marketplaces stay "connected" (nothing to disconnect)', async () => {
    const info = (await req(t.app, 'POST', '/api/marketplaces/vinted/disconnect')).json();
    expect(info.connection.status).toBe('connected');
  });
  it('browser marketplaces become logged_out and their profile folder is deleted', async () => {
    __setAdaptersForTest([fakeAdapter('poshmark', { kind: 'browser' }), ...real.filter((a) => a.id !== 'poshmark')]);
    const { profileDir } = await import('../../src/server/paths');
    fs.mkdirSync(profileDir('poshmark'), { recursive: true });
    fs.writeFileSync(`${profileDir('poshmark')}/Cookies`, 'x');
    const info = (await req(t.app, 'POST', '/api/marketplaces/poshmark/disconnect')).json();
    expect(info.connection.status).toBe('logged_out');
    expect(fs.existsSync(profileDir('poshmark'))).toBe(false);
    expect((await req(t.app, 'POST', '/api/marketplaces/nope/disconnect')).statusCode).toBe(400);
  });
});
