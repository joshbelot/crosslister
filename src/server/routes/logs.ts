import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, like, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { LogEntry } from '../../shared/types';
import type { MarketplaceId } from '../../shared/constants';
import { logs } from '../db/schema';

const LEVELS_FROM = {
  debug: ['debug', 'info', 'warn', 'error'],
  info: ['info', 'warn', 'error'],
  warn: ['warn', 'error'],
  error: ['error'],
} as const;

const querySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  marketplaceId: z.string().optional(),
  listingId: z.string().optional(),
  jobId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  before: z.coerce.number().int().optional(),
});

export async function logsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (req) => {
    const q = querySchema.parse(req.query);
    const conds: SQL[] = [inArray(logs.level, [...LEVELS_FROM[q.level]])];
    if (q.marketplaceId) conds.push(eq(logs.marketplaceId, q.marketplaceId));
    if (q.listingId) conds.push(eq(logs.listingId, q.listingId));
    if (q.jobId) conds.push(eq(logs.jobId, q.jobId));
    if (q.before) conds.push(lt(logs.id, q.before));
    if (q.q) {
      const term = `%${q.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      const c = or(like(logs.message, term), like(logs.scope, term));
      if (c) conds.push(c);
    }
    const rows = app.db.select().from(logs).where(and(...conds)).orderBy(desc(logs.id)).limit(q.limit).all();
    const items: LogEntry[] = rows.map((r) => ({
      id: r.id, ts: r.ts, level: r.level as LogEntry['level'], scope: r.scope, message: r.message,
      listingId: r.listingId, jobId: r.jobId, marketplaceId: r.marketplaceId as MarketplaceId | null, data: r.data ?? null,
    }));
    return { items };
  });
}
