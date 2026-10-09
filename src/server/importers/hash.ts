import { computeDhash } from '../services/imageProcessing';

/** dHashes of the first `n` files; unreadable files are skipped. */
export async function hashFirstPhotos(files: string[], n: number): Promise<string[]> {
  const out: string[] = [];
  for (const f of files.slice(0, n)) {
    try { out.push(await computeDhash(f)); } catch { /* ignore unreadable image */ }
  }
  return out;
}
