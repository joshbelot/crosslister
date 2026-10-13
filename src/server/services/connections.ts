import fs from 'node:fs';
import type { MarketplaceId } from '../../shared/constants';
import { browserManager, browserMode } from '../browser/browserManager';
import type { Db } from '../db/client';
import { getAdapter } from '../marketplaces/registry';
import type { BrowserAdapter } from '../marketplaces/types';
import { profileDir } from '../paths';
import { upsertConnection } from './connectionStore';
import { logger } from './logger';

export { getConnection, upsertConnection } from './connectionStore';

/** Forget the saved login for a marketplace: shared Chrome → delete that site's cookies and close its tab; launch mode → close the window and delete its profile; API adapters clean up their secrets. */
export async function disconnectMarketplace(db: Db, mp: MarketplaceId): Promise<void> {
  const adapter = getAdapter(mp);
  if (adapter.kind === 'browser') {
    if (browserMode() === 'attach') {
      // One shared Chrome profile: log out of this site only by deleting its cookies, then close its tab.
      try {
        await browserManager.clearSiteCookies((adapter as unknown as BrowserAdapter).hosts ?? []);
      } catch (err) {
        logger.warn(mp.toUpperCase(), `Could not clear cookies: ${(err as Error).message}`, { marketplaceId: mp });
      }
      await browserManager.close(mp);
    } else {
      await browserManager.close(mp);
      fs.rmSync(profileDir(mp), { recursive: true, force: true });
    }
  }
  await adapter.disconnect?.(db);
  upsertConnection(db, mp, { status: adapter.kind === 'manual' ? 'connected' : 'logged_out', message: adapter.kind === 'manual' ? 'Manual marketplace — nothing to connect.' : null });
  logger.info(mp.toUpperCase(), 'Disconnected', { marketplaceId: mp });
}
