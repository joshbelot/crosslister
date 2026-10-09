import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { photoEditSchema, photoOrderSchema } from '../../shared/schemas';
import { AppError } from '../errors';
import { displayPath, originalPath, thumbPath } from '../services/imageProcessing';
import { deletePhoto, editPhoto, getPhotoRow, reorderPhotos, uncroppedPath, uploadPhotos } from '../services/photos';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function sendFile(reply: FastifyReply, file: string, type: string, headers: Record<string, string> = {}): FastifyReply {
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 404, 'That photo file was not found.');
  for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  return reply.type(type).send(fs.createReadStream(file));
}

export async function photosRoutes(app: FastifyInstance): Promise<void> {
  app.post('/listings/:id/photos', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return uploadPhotos(app.db, id, req.files());
  });

  app.patch('/listings/:id/photos/order', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return reorderPhotos(app.db, id, photoOrderSchema.parse(req.body).photoIds);
  });

  app.patch('/photos/:photoId', async (req) => {
    const { photoId } = z.object({ photoId: z.string() }).parse(req.params);
    return editPhoto(app.db, photoId, photoEditSchema.parse(req.body));
  });

  app.delete('/photos/:photoId', async (req, reply) => {
    deletePhoto(app.db, z.object({ photoId: z.string() }).parse(req.params).photoId);
    return reply.status(204).send();
  });

  app.get('/photos/:photoId/thumb', async (req, reply) => {
    const row = getPhotoRow(app.db, z.object({ photoId: z.string() }).parse(req.params).photoId);
    return sendFile(reply, thumbPath(row), 'image/jpeg', { 'Cache-Control': IMMUTABLE });
  });

  app.get('/photos/:photoId/display', async (req, reply) => {
    const { photoId } = z.object({ photoId: z.string() }).parse(req.params);
    const { uncropped } = z.object({ uncropped: z.string().optional() }).parse(req.query);
    const row = getPhotoRow(app.db, photoId);
    const file = uncropped === '1' ? await uncroppedPath(row) : displayPath(row);
    return sendFile(reply, file, 'image/jpeg', { 'Cache-Control': IMMUTABLE });
  });

  app.get('/photos/:photoId/original', async (req, reply) => {
    const row = getPhotoRow(app.db, z.object({ photoId: z.string() }).parse(req.params).photoId);
    const safe = row.originalFilename.replace(/["\\\r\n]/g, '_');
    return sendFile(reply, originalPath(row), row.mimeType, { 'Content-Disposition': `inline; filename="${safe}"` });
  });
}
