import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { paths } from '../paths';

const execFileAsync = promisify(execFile);
const SERVICE = 'crosslister';

function filePath(name: string): string {
  return path.join(paths.secretsDir, `${name.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
}

/** Secrets live in the macOS Keychain (service `crosslister`), or in `data/secrets/<name>.json` (mode 0600) elsewhere. Never logged or returned by any API. */
export async function getSecret(name: string): Promise<string | null> {
  if (config.secretsBackend === 'keychain') {
    try {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w']);
      return stdout.replace(/\n$/, '');
    } catch (err) {
      if ((err as { code?: number }).code === 44) return null;
      return null;
    }
  }
  try {
    return (JSON.parse(fs.readFileSync(filePath(name), 'utf8')) as { value: string }).value;
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (config.secretsBackend === 'keychain') {
    await execFileAsync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w', value]);
    return;
  }
  fs.mkdirSync(paths.secretsDir, { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify({ value }), { mode: 0o600 });
  fs.chmodSync(filePath(name), 0o600);
}

export async function deleteSecret(name: string): Promise<void> {
  if (config.secretsBackend === 'keychain') {
    try { await execFileAsync('security', ['delete-generic-password', '-s', SERVICE, '-a', name]); } catch { /* not found */ }
    return;
  }
  fs.rmSync(filePath(name), { force: true });
}
