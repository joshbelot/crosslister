import { execFile } from 'node:child_process';

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** macOS desktop notification; no-op elsewhere. Never throws. */
export function notifyUser(title: string, message: string): void {
  if (process.platform !== 'darwin' || process.env.CROSSLISTER_QUIET === '1') return;
  try {
    execFile('osascript', ['-e', `display notification ${q(message)} with title ${q(title)}`], () => { /* ignore */ });
  } catch { /* ignore */ }
}
