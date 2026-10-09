import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { paths } from '../paths';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const version: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

const openFolderSchema = z.object({ which: z.enum(['data', 'logs', 'profiles', 'backups']) });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    version,
    dataDir: path.dirname(paths.dbFile),
    profilesDir: paths.profilesDir,
    logsDir: paths.logsDir,
    backupsDir: paths.backupsDir,
    platform: process.platform,
  }));

  app.post('/system/open-folder', async (req) => {
    const { which } = openFolderSchema.parse(req.body);
    const dir = { data: path.dirname(paths.dbFile), logs: paths.logsDir, profiles: paths.profilesDir, backups: paths.backupsDir }[which];
    fs.mkdirSync(dir, { recursive: true });
    if (process.platform === 'darwin') execFile('open', [dir], () => { /* ignore */ });
    return { path: dir };
  });
}
