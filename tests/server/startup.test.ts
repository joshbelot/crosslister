import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

describe('real server entry point', () => {
  it('boots with the real module graph (catches import-cycle and startup-order bugs) and answers /api/health', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crosslister-boot-'));
    const port = await freePort();
    const child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'src/server/index.ts'], {
      env: {
        ...process.env, PORT: String(port), CROSSLISTER_DATA_DIR: path.join(root, 'data'), CROSSLISTER_PROFILES_DIR: path.join(root, 'profiles'),
        CROSSLISTER_LOGS_DIR: path.join(root, 'logs'), CROSSLISTER_QUIET: '1', NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    let exited = false;
    child.on('exit', () => { exited = true; });
    try {
      let body: { ok?: boolean } | null = null;
      for (let i = 0; i < 150 && !body && !exited; i++) {
        try { body = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { ok?: boolean }; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      expect(exited, `server exited early:\n${output}`).toBe(false);
      expect(body?.ok).toBe(true);
      const marketplaces = (await (await fetch(`http://127.0.0.1:${port}/api/marketplaces`)).json()) as Array<{ id: string }>;
      expect(marketplaces).toHaveLength(10);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 40_000);
});
