import type { FastifyInstance } from 'fastify';
import type { AppEvent } from '../../shared/types';
import { events } from '../services/events';

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const send = (e: AppEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const unsubscribe = events.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
  });
}
