import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedListing, multipart } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { createBackup } from '../../src/server/services/backup';
import { buildExport } from '../../src/server/services/exporter';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

const upload = (name: string, buffer: Buffer, type: string) => {
  const { payload, headers } = multipart([{ name, buffer, type }]);
  // the route reads the first file part regardless of field name
  return t.app.inject({ method: 'POST', url: '/api/import/backup', payload, headers });
};

describe('restore from backup', () => {
  it('round-trips a ZIP: new id, same SKU, marketplace rows and photo rotation restored', async () => {
    const l = await seedListing(t.app, { title: 'Backup me jacket' });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m99999999/' });
    await req(t.app, 'PATCH', `/api/photos/${l.photos[0].id}`, { rotation: 90 });
    const { file } = await createBackup(t.db);
    expect((await req(t.app, 'DELETE', `/api/listings/${l.id}?force=1`)).statusCode).toBe(204);

    const res = await upload('backup.zip', fs.readFileSync(file), 'application/zip');
    expect(res.statusCode, res.body).toBe(200);
    const { batch, count } = res.json();
    expect(count).toBe(1);
    const staged = (await req(t.app, 'GET', `/api/import/batches/${batch.id}`)).json();
    expect(staged.batch).toMatchObject({ method: 'backup', state: 'review' });
    const item = staged.items[0];
    expect(item).toMatchObject({ state: 'fetched', photoCount: 1, existingListingId: null });

    const done = (await req(t.app, 'POST', `/api/import/items/${item.id}/commit`, { action: 'new' })).json();
    const restored = done.listing;
    expect(restored.id).not.toBe(l.id);
    expect(restored.sku).toBe(l.sku);
    expect(restored.title).toBe('Backup me jacket');
    expect(restored.photos).toHaveLength(1);
    expect(restored.photos[0].rotation).toBe(90);
    const mercari = restored.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'mercari');
    expect(mercari).toMatchObject({ status: 'active', remoteId: 'm99999999' });
    expect(restored.status).toBe('listed');
  });

  it('marks listings that already exist and merges without overwriting', async () => {
    const l = await seedListing(t.app, { title: 'Already here', brand: '' });
    const exp = buildExport(t.db);
    exp.listings = exp.listings.filter((x) => x.id === l.id).map((x) => ({ ...x, brand: 'Patagonia', title: 'Different title' }));
    const res = await upload('export.json', Buffer.from(JSON.stringify(exp)), 'application/json');
    expect(res.statusCode, res.body).toBe(200);
    const staged = (await req(t.app, 'GET', `/api/import/batches/${res.json().batch.id}`)).json();
    const item = staged.items[0];
    expect(item.existingListingId).toBe(l.id);
    // commit-all never touches items that already exist
    const all = (await req(t.app, 'POST', `/api/import/batches/${staged.batch.id}/commit-all`, { mode: 'new_without_duplicates' })).json();
    expect(all.imported).toBe(0);
    const merged = (await req(t.app, 'POST', `/api/import/items/${item.id}/commit`, { action: 'merge', targetListingId: l.id })).json();
    expect(merged.listing.title).toBe('Already here');
    expect(merged.listing.brand).toBe('Patagonia');
  });

  it('rejects other export versions, bad JSON and unsupported files', async () => {
    const v2 = await upload('x.json', Buffer.from(JSON.stringify({ exportVersion: 2, listings: [] })), 'application/json');
    expect(v2.statusCode).toBe(400);
    expect(v2.json().error.code).toBe('UNSUPPORTED_BACKUP');
    expect((await upload('x.json', Buffer.from('nope'), 'application/json')).statusCode).toBe(400);
    expect((await upload('x.zip', Buffer.from('not a zip'), 'application/zip')).statusCode).toBe(400);
    expect((await upload('x.txt', Buffer.from('hi'), 'text/plain')).statusCode).toBe(400);
  });
});
