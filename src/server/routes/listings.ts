import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { INVENTORY_FILTERS } from '../../shared/constants';
import { listingCreateSchema, listingPatchSchema } from '../../shared/schemas';
import {
  archiveListing, createListing, deleteListing, duplicateListing, getListing, listListings, unarchiveListing,
  updateListing,
} from '../services/listings';

const listQuerySchema = z.object({
  filter: z.enum(INVENTORY_FILTERS).default('all'),
  q: z.string().default(''),
  sort: z.enum(['updated_desc', 'created_desc', 'price_desc', 'price_asc', 'title_asc']).default('updated_desc'),
});
const idParams = z.object({ id: z.string() });

export async function listingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/listings', async (req) => listListings(app.db, listQuerySchema.parse(req.query)));

  app.post('/listings', async (req, reply) => {
    const body = listingCreateSchema.parse(req.body ?? {});
    return reply.status(201).send(createListing(app.db, body));
  });

  app.get('/listings/:id', async (req) => getListing(app.db, idParams.parse(req.params).id));

  app.patch('/listings/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return updateListing(app.db, id, listingPatchSchema.parse(req.body ?? {}));
  });

  app.delete('/listings/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { force } = z.object({ force: z.string().optional() }).parse(req.query);
    deleteListing(app.db, id, { force: force === '1' || force === 'true' });
    return reply.status(204).send();
  });

  app.post('/listings/:id/duplicate', async (req, reply) =>
    reply.status(201).send(await duplicateListing(app.db, idParams.parse(req.params).id)));
  app.post('/listings/:id/archive', async (req) => archiveListing(app.db, idParams.parse(req.params).id));
  app.post('/listings/:id/unarchive', async (req) => unarchiveListing(app.db, idParams.parse(req.params).id));
}
