import { eq } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { marketplaceConnections } from '../db/schema';
import type { ConnectionResult } from '../marketplaces/types';
import { events } from './events';

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
