import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { MAX_UPLOAD_BYTES } from '../shared/constants';
import type { Db } from './db/client';
import { config } from './config';
import { AppError } from './errors';
import { initBrowserManager } from './browser/browserManager';
import { jobRunner } from './services/jobRunner';
import { logger } from './services/logger';
import { eventsRoutes } from './routes/events';
import { healthRoutes } from './routes/health';
import { jobsRoutes } from './routes/jobs';
import { listingsRoutes } from './routes/listings';
import { logsRoutes } from './routes/logs';
import { marketplacesRoutes } from './routes/marketplaces';
import { photosRoutes } from './routes/photos';
import { salesRoutes } from './routes/sales';
import { settingsRoutes } from './routes/settings';

declare module 'fastify' {
  interface FastifyInstance { db: Db }
}

export interface AppDeps { db: Db; startJobRunner?: boolean } // default true; tests pass false and drive the runner manually

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  app.decorate('db', deps.db);

  // Security: block other websites (DNS rebinding / CSRF). No CORS headers are ever sent.
  const allowedHosts = new Set([
    `127.0.0.1:${config.port}`, `localhost:${config.port}`, '127.0.0.1:5173', 'localhost:5173',
  ]);
  app.addHook('onRequest', async (req) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts.has(host)) throw new AppError('FORBIDDEN_HOST', 403, 'Request blocked.');
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating) {
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) {
        throw new AppError('FORBIDDEN_ORIGIN', 403, 'Request blocked.');
      }
      if (req.headers['x-crosslister'] !== '1') throw new AppError('MISSING_HEADER', 403, 'Request blocked.');
    }
  });

  app.setErrorHandler((err: Error & { code?: string; statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.userMessage, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Some fields are invalid.', issues: err.issues } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'That photo is larger than 50 MB.' } });
    }
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'The request was not understood.' } });
    }
    logger.error('SERVER', err.message, { data: { stack: err.stack } });
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Something went wrong. Details were written to the log.' },
    });
  });

  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 30 } });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(eventsRoutes);
    await api.register(logsRoutes);
    await api.register(settingsRoutes);
    await api.register(listingsRoutes);
    await api.register(photosRoutes);
    await api.register(marketplacesRoutes);
    await api.register(jobsRoutes);
    await api.register(salesRoutes);
  }, { prefix: '/api' });

  if (config.isProd) {
    await app.register(fastifyStatic, { root: path.join(repoRoot, 'dist/web') });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That was not found.' } });
      }
      return reply.sendFile('index.html');
    });
  }

  initBrowserManager(deps.db);
  if (deps.startJobRunner !== false) {
    jobRunner.start(deps.db);
    app.addHook('onClose', async () => { await jobRunner.stop(); });
  }

  return app;
}
