import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { backupPath, createBackup, listBackups } from '../services/backup';
import { buildCsv, buildExport } from '../services/exporter';

const today = () => new Date().toISOString().slice(0, 10);

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/export/json', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="crosslister-export-${today()}.json"`);
    return reply.type('application/json; charset=utf-8').send(JSON.stringify(buildExport(app.db), null, 2));
  });

  app.get('/export/csv', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="crosslister-export-${today()}.csv"`);
    return reply.type('text/csv; charset=utf-8').send(buildCsv(app.db));
  });

  app.get('/export/backup', async (_req, reply) => {
    const { file, name } = await createBackup(app.db);
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.type('application/zip').send(fs.createReadStream(file));
  });

  app.get('/export/backups', async () => ({ items: listBackups() }));

  app.get('/export/backups/:name', async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const file = backupPath(name);
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.type('application/zip').send(fs.createReadStream(file));
  });
}
