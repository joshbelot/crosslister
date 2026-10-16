import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp';

describe('trace cleanup', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.cleanup(); });

  it('removes only trace folders older than keepTraceDays', async () => {
    const { paths } = await import('../../src/server/paths');
    const { purgeOldTraces } = await import('../../src/server/services/traces');
    const oldDir = path.join(paths.tracesDir, 'old-job');
    const newDir = path.join(paths.tracesDir, 'new-job');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    const past = new Date(Date.now() - 40 * 86_400_000);
    fs.utimesSync(oldDir, past, past);
    expect(purgeOldTraces(t.db, Date.now(), true)).toBe(1);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(newDir)).toBe(true);
  });
});
