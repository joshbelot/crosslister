import fs from 'node:fs';

/** Base64 of up to 4 image files; unreadable files are skipped. */
export function encodeImages(files: string[] | undefined): string[] {
  const out: string[] = [];
  for (const f of (files ?? []).slice(0, 4)) {
    try { out.push(fs.readFileSync(f).toString('base64')); } catch { /* skip */ }
  }
  return out;
}
