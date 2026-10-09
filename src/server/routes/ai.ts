import type { FastifyInstance } from 'fastify';
import { getProvider } from '../ai/provider';
import { getSettings } from '../services/settings';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/health', async () => getProvider(getSettings(app.db)).health());
}
