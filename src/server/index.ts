import { config } from './config';
import { buildApp } from './app';

const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Crosslister is running: open http://localhost:${config.isProd ? config.port : 5173}`);
