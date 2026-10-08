import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(healthRoutes, { prefix: '/api' });
  return app;
}
