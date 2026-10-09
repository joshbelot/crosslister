import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { marketplaceIdSchema } from '../../shared/schemas';
import { suggestAttributes, suggestDescription, suggestTitles } from '../ai/features';
import { getProvider } from '../ai/provider';
import { getSettings } from '../services/settings';

const listingBody = z.object({ listingId: z.string() });

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/health', async () => getProvider(getSettings(app.db)).health());

  app.post('/ai/description', async (req) => suggestDescription(app.db, listingBody.parse(req.body).listingId));

  app.post('/ai/titles', async (req) => {
    const b = listingBody.extend({ marketplaceIds: z.array(marketplaceIdSchema).optional() }).parse(req.body);
    return suggestTitles(app.db, b.listingId, b.marketplaceIds ?? []);
  });

  app.post('/ai/attributes', async (req) => suggestAttributes(app.db, listingBody.parse(req.body).listingId));
}
