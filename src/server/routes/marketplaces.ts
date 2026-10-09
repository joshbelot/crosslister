import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MarketplaceId } from '../../shared/constants';
import {
  marketplaceIdSchema, marketplaceListingPatchSchema, markListedSchema, marketplaceTargetsSchema,
} from '../../shared/schemas';
import type { MarketplaceInfo } from '../../shared/types';
import { marketplaceConnections } from '../db/schema';
import { allAdapters } from '../marketplaces/registry';
import {
  markEnded, markListed, openPhotos, patchTarget, previewTarget, removeTarget, setTargets,
} from '../services/marketplaceListings';
import { disconnectMarketplace } from '../services/connections';
import { getSettings } from '../services/settings';
import { buildValidationReport } from '../services/validation';

const listingParams = z.object({ id: z.string() });
const targetParams = z.object({ id: z.string(), mp: marketplaceIdSchema });

export function marketplaceInfos(app: FastifyInstance): MarketplaceInfo[] {
  const settings = getSettings(app.db);
  const conns = new Map(app.db.select().from(marketplaceConnections).all().map((c) => [c.marketplaceId, c]));
  return allAdapters().map((a) => {
    const c = conns.get(a.id);
    const connection: MarketplaceInfo['connection'] = c
      ? { status: c.status as MarketplaceInfo['connection']['status'], accountName: c.accountName, checkedAt: c.checkedAt, message: c.message }
      : a.kind === 'manual'
        ? { status: 'connected', accountName: null, checkedAt: null, message: 'Manual marketplace — nothing to connect.' }
        : { status: 'unknown', accountName: null, checkedAt: null, message: null };
    return {
      id: a.id, name: a.name, kind: a.kind, capabilities: a.capabilities, connection,
      prefs: settings.marketplaces[a.id], urls: { home: a.urls.home, sell: a.urls.sell }, dataFields: a.dataFields,
    };
  });
}

export async function marketplacesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/marketplaces', async () => marketplaceInfos(app));

  app.post('/marketplaces/:mp/disconnect', async (req) => {
    const { mp } = z.object({ mp: marketplaceIdSchema }).parse(req.params);
    await disconnectMarketplace(app.db, mp);
    return marketplaceInfos(app).find((m) => m.id === mp)!;
  });

  app.put('/listings/:id/marketplaces', async (req) => {
    const { id } = listingParams.parse(req.params);
    return setTargets(app.db, id, marketplaceTargetsSchema.parse(req.body).marketplaceIds);
  });

  app.patch('/listings/:id/marketplaces/:mp', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    return patchTarget(app.db, id, mp, marketplaceListingPatchSchema.parse(req.body ?? {}));
  });

  app.delete('/listings/:id/marketplaces/:mp', async (req, reply) => {
    const { id, mp } = targetParams.parse(req.params);
    removeTarget(app.db, id, mp);
    return reply.status(204).send();
  });

  app.get('/listings/:id/validation', async (req) => {
    const { id } = listingParams.parse(req.params);
    const { marketplaceIds } = z.object({ marketplaceIds: z.string().optional() }).parse(req.query);
    const ids = marketplaceIds
      ? z.array(marketplaceIdSchema).parse(marketplaceIds.split(',').map((s) => s.trim()).filter(Boolean))
      : undefined;
    return buildValidationReport(app.db, id, ids as MarketplaceId[] | undefined);
  });

  app.get('/listings/:id/marketplaces/:mp/preview', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    return previewTarget(app.db, id, mp);
  });

  app.post('/listings/:id/marketplaces/:mp/mark-listed', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    return markListed(app.db, id, mp, markListedSchema.parse(req.body ?? {}));
  });

  app.post('/listings/:id/marketplaces/:mp/mark-ended', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    return markEnded(app.db, id, mp);
  });

  app.post('/listings/:id/marketplaces/:mp/open-photos', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    return openPhotos(app.db, id, mp);
  });

  // Adapter-specific routes (e.g. eBay category search) live under /api/marketplaces/<id>/…
  for (const adapter of allAdapters()) {
    if (!adapter.registerRoutes) continue;
    await app.register(async (scoped) => { adapter.registerRoutes!(scoped); }, { prefix: `/marketplaces/${adapter.id}` });
  }
}
