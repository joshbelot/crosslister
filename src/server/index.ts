import { config } from './config';
import { ensureDirs, paths } from './paths';
import { openDb } from './db/client';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { recoverInterruptedJobs } from './services/jobs';
import { browserManager } from './browser/browserManager';
import { cleanupEmptyDrafts } from './services/listings';
import { initLogger, logger, purgeOldLogs } from './services/logger';

ensureDirs();
const db = openDb(paths.dbFile);
runMigrations(db);
initLogger(db);
logger.info('SERVER', 'Starting Crosslister');
purgeOldLogs(db, 30);
cleanupEmptyDrafts(db);
recoverInterruptedJobs(db);

const app = await buildApp({ db });
await app.listen({ host: '127.0.0.1', port: config.port });
logger.info('SERVER', `Crosslister is running: open http://localhost:${config.isProd ? config.port : 5173}`);

async function shutdown(): Promise<void> {
  await browserManager.closeAll();
  await app.close();
  db.$client.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
