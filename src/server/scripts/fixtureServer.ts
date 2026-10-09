import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/marketplace-pages');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

/** Resolve a request path to a fixture file; unknown paths under /<mp>/ fall back to that marketplace's item/edit page. */
function resolveFile(urlPath: string): string | null {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const abs = path.join(root, clean);
  if (!abs.startsWith(root)) return null;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const mp = clean.split(path.sep)[0];
  if (!mp) return null;
  const fallback = /selling/i.test(clean) ? 'selling.html' : /edit/i.test(clean) ? 'edit.html' : /listing\//i.test(clean) && fs.existsSync(path.join(root, mp, 'listing.html')) ? 'listing.html' : 'item.html';
  const f = path.join(root, mp, fallback);
  return fs.existsSync(f) ? f : null;
}

/** Plain `node:http` static server for the fixture marketplace pages (05 §9.2). Pass port 0 for a random free port. */
export async function startFixtureServer(port = 4399): Promise<{ close(): Promise<void>; url: string }> {
  const server = http.createServer((req, res) => {
    const file = resolveFile(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actual = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startFixtureServer();
  console.log(`Fixture server running at ${url}  (pages: ${url}/<marketplace>/sell.html)`);
}
