import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client';
import { paths } from '../paths';
import { registerTick } from './jobRunner';
import { getSettings } from './settings';

let lastPurge = 0;

/** Delete trace folders older than `keepTraceDays`. Runs at most every 6 hours. */
export function purgeOldTraces(db: Db, now = Date.now(), force = false): number {
  if (!force && now - lastPurge < 6 * 3_600_000) return 0;
  lastPurge = now;
  const cutoff = now - getSettings(db).diagnostics.keepTraceDays * 86_400_000;
  if (!fs.existsSync(paths.tracesDir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(paths.tracesDir)) {
    const dir = path.join(paths.tracesDir, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
    } catch { /* already gone */ }
  }
  return removed;
}

registerTick((db) => { purgeOldTraces(db); });
