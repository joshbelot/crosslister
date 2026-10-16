import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { saleUpdateSchema } from '../../shared/schemas';
import { listSales, salesCsv, updateSale } from '../services/salesLedger';

const idParam = z.object({ id: z.string() });
const query = z.object({
  from: z.string().optional(), to: z.string().optional(), marketplaceId: z.string().optional(), q: z.string().optional(),
});

export async function salesLedgerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sales', async (req) => listSales(app.db, query.parse(req.query)));

  app.get('/sales/export.csv', async (req, reply) => {
    reply.header('content-disposition', 'attachment; filename="crosslister-sales.csv"');
    return reply.type('text/csv; charset=utf-8').send(salesCsv(app.db, query.parse(req.query)));
  });

  app.patch('/sales/:id', async (req) => updateSale(app.db, idParam.parse(req.params).id, saleUpdateSchema.parse(req.body)));
}
