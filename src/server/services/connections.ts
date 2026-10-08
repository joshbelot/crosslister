import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { marketplaceConnections } from '../db/schema';
import type { ConnectionResult } from '../marketplaces/types';
import { browserManager } from '../browser/browserManager';
import { getAdapter } from '../marketplaces/registry';
import { profileDir } from '../paths';
import { events } from './events';
import { logger } from './logger';

export function upsertConnection(db: Db, mp: MarketplaceId, conn: ConnectionResult | { status: string; accountName?: string | null; message?: string | null }): void {
  const row = {
    marketplaceId: mp, status: conn.status, accountName: conn.accountName ?? null,
    checkedAt: new Date().toISOString(), message: conn.message ?? null,
  };
  db.insert(marketplaceConnections).values(row)
    .onConflictDoUpdate({ target: marketplaceConnections.marketplaceId, set: row }).run();
  events.publish({ type: 'connection.updated', marketplaceId: mp });
}

export function getConnection(db: Db, mp: MarketplaceId) {
  return db.select().from(marketplaceConnections).where(eq(marketplaceConnections.marketplaceId, mp)).get();
}

/** Forget the saved login for a marketplace: browser → close the window and delete its profile; API adapters clean up their secrets. */
export async function disconnectMarketplace(db: Db, mp: MarketplaceId): Promise<void> {
  const adapter = getAdapter(mp);
  if (adapter.kind === 'browser') {
    await browserManager.close(mp);
    fs.rmSync(profileDir(mp), { recursive: true, force: true });
  }
  await adapter.disconnect?.(db);
  upsertConnection(db, mp, { status: adapter.kind === 'manual' ? 'connected' : 'logged_out', message: adapter.kind === 'manual' ? 'Manual marketplace — nothing to connect.' : null });
  logger.info(mp.toUpperCase(), 'Disconnected', { marketplaceId: mp });
}
