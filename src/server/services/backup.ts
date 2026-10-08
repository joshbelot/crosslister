import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { photos } from '../db/schema';
import { AppError } from '../errors';
import { derivedDir, paths } from '../paths';
import { buildExport } from './exporter';
import { generateDerived } from './imageProcessing';
import { logger } from './logger';

const KEEP_BACKUPS = 10;
const NAME_RE = /^crosslister-backup-[\d-]+\.zip$/;
const pad = (n: number) => String(n).padStart(2, '0');

export interface BackupInfo { name: string; bytes: number; createdAt: string }

function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(paths.backupsDir)) return [];
  return fs.readdirSync(paths.backupsDir).filter((f) => NAME_RE.test(f)).map((name) => {
    const st = fs.statSync(path.join(paths.backupsDir, name));
    return { name, bytes: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

export function backupPath(name: string): string {
  if (!NAME_RE.test(name)) throw new AppError('BAD_NAME', 400, 'That is not a backup file name.');
  const file = path.join(paths.backupsDir, name);
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 404, 'That backup was not found.');
  return file;
}

/** Writes data/backups/crosslister-backup-<stamp>.zip and returns its path. */
export async function createBackup(db: Db): Promise<{ file: string; name: string }> {
  fs.mkdirSync(paths.backupsDir, { recursive: true });
  const ts = Date.now();
  const snapshot = path.join(paths.backupsDir, `tmp-${ts}.db`);
  await db.$client.backup(snapshot);

  let name = `crosslister-backup-${stamp()}.zip`;
  if (fs.existsSync(path.join(paths.backupsDir, name))) name = `crosslister-backup-${stamp()}-${String(ts % 100000).padStart(5, '0')}.zip`;
  const file = path.join(paths.backupsDir, name);
  const exportData = buildExport(db);

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      out.on('close', () => resolve());
      out.on('error', reject);
      archive.on('error', reject);
      archive.pipe(out);
      archive.file(snapshot, { name: 'crosslister.db' });
      archive.append(JSON.stringify(exportData, null, 2), { name: 'export.json' });
      for (const l of exportData.listings) {
        for (const p of l.photos) {
          const abs = path.join(paths.listingsDir, '..', p.file);
          if (fs.existsSync(abs)) archive.file(abs, { name: p.file });
        }
      }
      archive.append(
        `Crosslister backup created ${new Date().toISOString().slice(0, 10)}. To restore: quit Crosslister, move your current data folder aside, create a new data folder, unzip this archive into it, and start Crosslister. Or use Import → Restore from backup in the app.\n`,
        { name: 'README.txt' },
      );
      void archive.finalize();
    });
  } finally {
    fs.rmSync(snapshot, { force: true });
  }

  for (const old of listBackups().slice(KEEP_BACKUPS)) fs.rmSync(path.join(paths.backupsDir, old.name), { force: true });
  logger.info('EXPORT', `Backup created: ${name}`);
  return { file, name };
}

/** Startup check: regenerate thumbs/displays that are missing (e.g. after restoring a backup). */
export async function regenerateMissingDerived(db: Db): Promise<number> {
  let count = 0;
  for (const p of db.select().from(photos).all()) {
    const thumb = path.join(derivedDir(p.listingId), `${p.id}_thumb.jpg`);
    const display = path.join(derivedDir(p.listingId), `${p.id}_display.jpg`);
    if (fs.existsSync(thumb) && fs.existsSync(display)) continue;
    try {
      const { dhash } = await generateDerived(p);
      db.update(photos).set({ dhash }).where(eq(photos.id, p.id)).run();
      count++;
    } catch (err) {
      logger.warn('PHOTOS', `Could not regenerate previews for ${p.id}: ${(err as Error).message}`, { listingId: p.listingId });
    }
  }
  if (count) logger.info('PHOTOS', `Regenerated previews for ${count} photo(s)`);
  return count;
}
