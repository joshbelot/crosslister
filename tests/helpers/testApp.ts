import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Db } from '../../src/server/db/client';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  dataDir: string;
  cleanup(): Promise<void>;
}

/** Creates an app backed by a temp data dir. Env vars are set BEFORE the server modules are imported. */
export async function createTestApp(opts: { initLogger?: boolean } = {}): Promise<TestApp> {
  // tests/helpers/setupEnv.ts normally creates the temp root; fall back to creating one here.
  let dataDir = process.env.CROSSLISTER_TEST_ROOT;
  if (!dataDir) {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crosslister-test-'));
    process.env.CROSSLISTER_DATA_DIR = path.join(dataDir, 'data');
    process.env.CROSSLISTER_PROFILES_DIR = path.join(dataDir, 'profiles');
    process.env.CROSSLISTER_LOGS_DIR = path.join(dataDir, 'logs');
    process.env.CROSSLISTER_SECRETS_BACKEND = 'file';
    process.env.CROSSLISTER_QUIET = '1';
  }
  const root = dataDir;
  const { ensureDirs, paths } = await import('../../src/server/paths');
  const { openDb } = await import('../../src/server/db/client');
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { buildApp } = await import('../../src/server/app');
  const { initLogger, closeLogger } = await import('../../src/server/services/logger');
  ensureDirs();
  const db = openDb(paths.dbFile);
  runMigrations(db);
  if (opts.initLogger !== false) initLogger(db);
  const app = await buildApp({ db, startJobRunner: false });
  await app.ready();
  return {
    app, db, dataDir: root,
    async cleanup() {
      await app.close();
      closeLogger();
      db.$client.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export const TEST_HEADERS = {
  host: '127.0.0.1:4317',
  'x-crosslister': '1',
  origin: 'http://127.0.0.1:5173',
};

export function req(app: FastifyInstance, method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method, url,
    headers: { ...TEST_HEADERS, ...headers },
    ...(body === undefined ? {} : { payload: body as InjectOptions['payload'] }),
  });
}
