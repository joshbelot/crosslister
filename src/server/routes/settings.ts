import type { FastifyInstance } from 'fastify';
import { desc, ne } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import { settingsSchema } from '../../shared/schemas';
import type { Settings } from '../../shared/types';
import { listings } from '../db/schema';
import { CATEGORIES } from '../../shared/taxonomy';
import { marketplaceIdSchema } from '../../shared/schemas';
import { getAdapter } from '../marketplaces/registry';
import { setKv } from '../services/settings';
import { z } from 'zod';
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

  // Small UI flags stored in the settings table (allow-listed keys only).
  const UI_KV_KEYS = ['poshmark_notice_ack'] as const;
  app.get('/settings/kv/:key', async (req) => {
    const { key } = z.object({ key: z.enum(UI_KV_KEYS) }).parse(req.params);
    return { value: getKv<unknown>(app.db, key, null) };
  });
  app.put('/settings/kv/:key', async (req) => {
    const { key } = z.object({ key: z.enum(UI_KV_KEYS) }).parse(req.params);
    const { value } = z.object({ value: z.unknown() }).parse(req.body);
    setKv(app.db, key, value);
    return { value };
  });

  app.get('/settings/category-map/:mp', async (req) => {
    const { mp } = z.object({ mp: marketplaceIdSchema }).parse(req.params);
    const adapter = getAdapter(mp);
    const builtIn: Record<string, string> = {};
    for (const c of CATEGORIES) {
      if (!c.selectable) continue;
      const path = adapter.categoryPath?.(c.id);
      if (path) builtIn[c.id] = path.map((seg) => (Array.isArray(seg) ? seg[0] : seg)).join(' > ');
    }
    return { map: getKv<Record<string, string>>(app.db, `category_map_${mp}`, {}), builtIn };
  });

  app.put('/settings/category-map/:mp', async (req) => {
    const { mp } = z.object({ mp: marketplaceIdSchema }).parse(req.params);
    const { map } = z.object({ map: z.record(z.string(), z.string()) }).parse(req.body);
    const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim() !== ''));
    setKv(app.db, `category_map_${mp}`, clean);
    return { map: clean };
  });
}
