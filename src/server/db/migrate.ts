import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: path.resolve(repoRoot, 'drizzle') });
}
