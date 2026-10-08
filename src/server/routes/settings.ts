import type { FastifyInstance } from 'fastify';
import { desc, ne } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import { settingsSchema } from '../../shared/schemas';
import type { Settings } from '../../shared/types';
import { listings } from '../db/schema';
import { getKv, getSettings, saveSettings } from '../services/settings';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async () => getSettings(app.db));

  app.put('/settings', async (req) => {
    const body = settingsSchema.parse(req.body) as Settings;
    return saveSettings(app.db, body);
  });

  app.get('/settings/kv/recent', async () => {
    const rows = app.db.select({ brand: listings.brand }).from(listings)
      .where(ne(listings.brand, '')).orderBy(desc(listings.updatedAt)).all();
    const brands: string[] = [];
    for (const r of rows) {
      if (!brands.includes(r.brand)) brands.push(r.brand);
      if (brands.length >= 200) break;
    }
    return {
      recentCategories: getKv<string[]>(app.db, 'recent_categories', []),
      lastMarketplaces: getKv<MarketplaceId[]>(app.db, 'last_marketplaces', []),
      brands,
    };
  });
}
