import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { continueJobSchema, crosslistSchema, marketplaceIdSchema } from '../../shared/schemas';
import { jobSteps, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import { crosslist } from '../services/crosslist';
import { resolveWaiter } from '../services/jobContext';
import { jobRunner } from '../services/jobRunner';
import { createJob, getJob, getJobRow, isTerminal, listJobs, updateJob } from '../services/jobs';
import { recomputeListingStatus } from '../services/listingStatus';
import { requireTarget } from '../services/marketplaceListings';
import { updateTarget } from '../services/marketplaceListings';

const idParam = z.object({ id: z.string() });
const targetParams = z.object({ id: z.string(), mp: marketplaceIdSchema });

export async function jobsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jobs', async (req) => {
    const q = z.object({
      listingId: z.string().optional(),
      active: z.enum(['0', '1']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(50),
    }).parse(req.query);
    return { items: listJobs(app.db, { listingId: q.listingId, active: q.active === '1', limit: q.limit }) };
  });

  app.get('/jobs/:id', async (req) => getJob(app.db, idParam.parse(req.params).id, { withSteps: true }));

  app.post('/jobs/:id/continue', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = continueJobSchema.parse(req.body ?? {});
    const row = getJobRow(app.db, id);
    if (row.state !== 'NEEDS_USER' || !resolveWaiter(id, body.url ?? null)) {
      throw new AppError('JOB_NOT_WAITING', 409, 'That job is not waiting for you.');
    }
    return getJob(app.db, id);
  });

  app.post('/jobs/:id/cancel', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = getJobRow(app.db, id);
    if (isTerminal(row.state)) throw new AppError('JOB_FINISHED', 409, 'That job has already finished.');
    if (row.state === 'NOT_STARTED' && !jobRunner.isRunning(id)) {
      updateJob(app.db, id, { state: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled.', finishedAt: new Date().toISOString() });
      if (row.type === 'publish' && row.listingId && row.marketplaceId) {
        const prev = (row.input as { previousStatus?: string } | null)?.previousStatus;
        app.db.update(marketplaceListings).set({ status: prev === 'active' ? 'active' : 'not_listed' }).where(and(
          eq(marketplaceListings.listingId, row.listingId), eq(marketplaceListings.marketplaceId, row.marketplaceId),
          eq(marketplaceListings.status, 'in_progress'),
        )).run();
      }
      if (row.listingId) recomputeListingStatus(app.db, row.listingId);
    } else if (!jobRunner.abort(id)) {
      throw new AppError('JOB_FINISHED', 409, 'That job is not running.');
    }
    return getJob(app.db, id);
  });

  app.post('/jobs/:id/retry', async (req) => {
    const { id } = idParam.parse(req.params);
    const row = getJobRow(app.db, id);
    if (row.state !== 'FAILED' && row.state !== 'CANCELLED') {
      throw new AppError('JOB_NOT_RETRYABLE', 409, 'Only failed or cancelled jobs can be retried.');
    }
    const input = { ...(row.input ?? {}) } as Record<string, unknown>;
    if (row.type === 'publish' && row.listingId && row.marketplaceId) {
      const target = requireTarget(app.db, row.listingId, row.marketplaceId as never);
      if (target.status === 'active') throw new AppError('ALREADY_LISTED', 409, 'That item is already listed there.');
      input.previousStatus = target.status;
      updateTarget(app.db, target.id, { status: 'in_progress', lastError: null, lastErrorCode: null });
      recomputeListingStatus(app.db, row.listingId);
    }
    return createJob(app.db, {
      type: row.type as never, marketplaceId: row.marketplaceId as never, listingId: row.listingId,
      input, attempt: row.attempt + 1, parentJobId: row.id,
    });
  });

  app.get('/jobs/:id/steps/:stepId/screenshot', async (req, reply) => {
    const { id, stepId } = z.object({ id: z.string(), stepId: z.coerce.number().int() }).parse(req.params);
    const step = app.db.select().from(jobSteps).where(and(eq(jobSteps.id, stepId), eq(jobSteps.jobId, id))).get();
    if (!step?.screenshotPath || !fs.existsSync(step.screenshotPath)) throw notFound('Screenshot');
    return reply.type('image/png').send(fs.createReadStream(step.screenshotPath));
  });

  app.post('/listings/:id/crosslist', async (req) => {
    const { id } = idParam.parse(req.params);
    return crosslist(app.db, id, crosslistSchema.parse(req.body).marketplaceIds);
  });

  app.post('/listings/:id/marketplaces/:mp/deactivate', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    const target = requireTarget(app.db, id, mp);
    if (target.status !== 'active') throw new AppError('NOT_ACTIVE', 409, 'That listing is not active on this marketplace.');
    return { job: createJob(app.db, { type: 'deactivate', marketplaceId: mp, listingId: id, input: { previousStatus: target.status } }) };
  });

  app.post('/listings/:id/marketplaces/:mp/update', async (req) => {
    const { id, mp } = targetParams.parse(req.params);
    const target = requireTarget(app.db, id, mp);
    if (target.status !== 'active') throw new AppError('NOT_ACTIVE', 409, 'That listing is not active on this marketplace.');
    if (getAdapter(mp).capabilities.update === 'none' || !getAdapter(mp).update) {
      throw new AppError('UPDATE_UNSUPPORTED', 409, 'This marketplace does not support pushing edits. Change the listing there directly.');
    }
    return { job: createJob(app.db, { type: 'update', marketplaceId: mp, listingId: id, input: { previousStatus: target.status } }) };
  });

  app.post('/marketplaces/:mp/connect', async (req) => {
    const { mp } = z.object({ mp: marketplaceIdSchema }).parse(req.params);
    getAdapter(mp);
    return { job: createJob(app.db, { type: 'connect', marketplaceId: mp, listingId: null }) };
  });
}
