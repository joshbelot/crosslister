import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { priceChangeSchema } from '../../shared/schemas';
import { applyPriceChange, previewPriceChange } from '../services/priceChange';

const idParam = z.object({ id: z.string() });

export async function priceChangeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/listings/:id/price-change/preview', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ priceCents: z.coerce.number().int().min(1), clearOverrides: z.enum(['0', '1']).default('0') }).parse(req.query);
    return { items: previewPriceChange(app.db, id, q.priceCents, q.clearOverrides === '1') };
  });
  app.post('/listings/:id/price-change', async (req) => {
    const { id } = idParam.parse(req.params);
    return applyPriceChange(app.db, id, priceChangeSchema.parse(req.body));
  });
}
