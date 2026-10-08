import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { marketplaceIdSchema, markSoldSchema } from '../../shared/schemas';
import { dismissSale, deactivateTargets, markSold, unmarkSold } from '../services/sales';
import { getListing } from '../services/listings';

const idParam = z.object({ id: z.string() });

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/listings/:id/mark-sold', async (req) => markSold(app.db, idParam.parse(req.params).id, markSoldSchema.parse(req.body)));
  app.post('/listings/:id/unmark-sold', async (req) => unmarkSold(app.db, idParam.parse(req.params).id));
  app.post('/listings/:id/dismiss-sale', async (req) => dismissSale(app.db, idParam.parse(req.params).id));
  app.post('/listings/:id/deactivate-all', async (req) => {
    const { id } = idParam.parse(req.params);
    getListing(app.db, id);
    const body = z.object({ marketplaceIds: z.array(marketplaceIdSchema).optional() }).parse(req.body ?? {});
    return { jobs: deactivateTargets(app.db, id, body.marketplaceIds) };
  });
}
