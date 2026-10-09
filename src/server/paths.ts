import fs from 'node:fs';
import path from 'node:path';
import type { MarketplaceId } from '../shared/constants';
import { config } from './config';

export const paths = {
  dbFile: path.join(config.dataDir, 'crosslister.db'),
  listingsDir: path.join(config.dataDir, 'listings'),
  backupsDir: path.join(config.dataDir, 'backups'),
  screenshotsDir: path.join(config.dataDir, 'screenshots'),
  importsDir: path.join(config.dataDir, 'imports'),
  tmpDir: path.join(config.dataDir, 'tmp'),
  secretsDir: path.join(config.dataDir, 'secrets'),
  logsDir: config.logsDir,
  profilesDir: config.profilesDir,
};
export const listingDir = (id: string) => path.join(paths.listingsDir, id);
export const originalDir = (id: string) => path.join(listingDir(id), 'original');
export const derivedDir = (id: string) => path.join(listingDir(id), 'derived');
export const processedDir = (id: string, mp: MarketplaceId) => path.join(listingDir(id), 'processed', mp);
export const profileDir = (mp: MarketplaceId) => path.join(paths.profilesDir, mp);

/** mkdir -p every directory in `paths` (not files). */
export function ensureDirs(): void {
  for (const [key, dir] of Object.entries(paths)) {
    if (key === 'dbFile') continue;
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
}
