import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listingPatchSchema, marketplaceIdSchema } from '../../shared/schemas';
import { AppError } from '../errors';
import { nanoid12 } from '../ids';
import { paths } from '../paths';
import { stageBackup } from '../importers/backupImport';
import {
  commitAll, commitItem, createBatch, deleteBatch, fetchSelected, getBatch, listBatches, stagedPhotoPath,
} from '../importers/pipeline';

const idParam = z.object({ id: z.string() });

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/import/batches', async (req) => {
    const body = z.object({
      marketplaceId: marketplaceIdSchema, method: z.enum(['api', 'shop_page', 'urls']),
      urls: z.array(z.string().url().regex(/^https?:\/\//i, 'Use an http(s) address')).max(200).optional(),
    }).superRefine((b, ctx) => { if (b.method === 'urls' && !b.urls?.length) ctx.addIssue({ code: 'custom', message: 'Paste at least one listing URL.', path: ['urls'] }); }).parse(req.body);
    return createBatch(app.db, body);
  });
  app.get('/import/batches', async () => ({ items: listBatches(app.db) }));
  app.get('/import/batches/:id', async (req) => getBatch(app.db, idParam.parse(req.params).id));
  app.delete('/import/batches/:id', async (req, reply) => { deleteBatch(app.db, idParam.parse(req.params).id); return reply.status(204).send(); });

  app.post('/import/batches/:id/fetch', async (req) => {
    const { id } = idParam.parse(req.params);
    const { itemIds } = z.object({ itemIds: z.array(z.string()).min(1) }).parse(req.body);
    return { job: fetchSelected(app.db, id, itemIds) };
  });
  app.post('/import/batches/:id/commit-all', async (req) => {
    const { id } = idParam.parse(req.params);
    z.object({ mode: z.literal('new_without_duplicates') }).parse(req.body);
    return commitAll(app.db, id);
  });
  app.post('/import/items/:id/commit', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ action: z.enum(['new', 'merge', 'skip']), targetListingId: z.string().optional(), overrides: listingPatchSchema.optional() }).parse(req.body);
    const { item, listing } = await commitItem(app.db, id, body);
    return { item: { ...item, raw: undefined }, listing };
  });
  app.post('/import/backup', async (req) => {
    const part = await req.file({ limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
    if (!part) throw new AppError('VALIDATION', 400, 'Choose a backup file (.zip or .json).');
    if (!/\.(zip|json)$/i.test(part.filename)) throw new AppError('UNSUPPORTED_BACKUP', 400, 'Choose a Crosslister backup (.zip or .json).');
    fs.mkdirSync(paths.tmpDir, { recursive: true });
    const tmp = path.join(paths.tmpDir, `upload-${nanoid12()}${path.extname(part.filename).toLowerCase()}`);
    try {
      await streamPipeline(part.file, fs.createWriteStream(tmp));
      if (part.file.truncated) throw new AppError('UNSUPPORTED_BACKUP', 400, 'That backup file is too large.');
      const { batchId, count } = await stageBackup(app.db, { path: tmp, name: part.filename });
      return { batch: getBatch(app.db, batchId).batch, count };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  app.get('/import/items/:id/photos/:n', async (req, reply) => {
    const { id, n } = z.object({ id: z.string(), n: z.coerce.number().int().min(0) }).parse(req.params);
    return reply.type('image/jpeg').send(fs.createReadStream(stagedPhotoPath(app.db, id, n)));
  });
}
