import fs from 'node:fs';
import path from 'node:path';
import { and, lt } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import type { LogEntry } from '../../shared/types';
import type { Db } from '../db/client';
import { logs } from '../db/schema';
import { paths } from '../paths';
import { events } from './events';

type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogCtx { listingId?: string | null; jobId?: string | null; marketplaceId?: MarketplaceId | null; data?: unknown }

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[-_]?key/i;

let dbRef: Db | null = null;
let stream: { day: string; ws: fs.WriteStream } | null = null;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
function localParts(d: Date) {
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

function fileStream(day: string): fs.WriteStream {
  if (stream && stream.day === day) return stream.ws;
  stream?.ws.end();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const ws = fs.createWriteStream(path.join(paths.logsDir, `app-${day}.log`), { flags: 'a' });
  ws.on('error', () => { /* never crash because of logging */ });
  stream = { day, ws };
  return ws;
}

export function formatLine(now: Date, level: Level, scope: string, message: string, ctx?: LogCtx): string {
  const { day, time } = localParts(now);
  const refs: string[] = [];
  if (ctx?.jobId) refs.push(`job=${ctx.jobId}`);
  if (ctx?.listingId) refs.push(`listing=${ctx.listingId}`);
  return `${day} ${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${refs.length ? `  (${refs.join(' ')})` : ''}`;
}

function write(level: Level, scope: string, message: string, ctx?: LogCtx): void {
  const now = new Date();
  const line = formatLine(now, level, scope, message, ctx);
  if (process.env.CROSSLISTER_QUIET !== '1') {
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  }
  if (!dbRef) return;
  try {
    fileStream(localParts(now).day).write(line + '\n');
  } catch { /* ignore */ }
  if (level === 'debug') return;
  try {
    const data = ctx?.data === undefined ? null : redact(ctx.data);
    const row = dbRef.insert(logs).values({
      ts: now.toISOString(), level, scope, message,
      listingId: ctx?.listingId ?? null, jobId: ctx?.jobId ?? null, marketplaceId: ctx?.marketplaceId ?? null, data,
    }).returning().get();
    if (LEVEL_RANK[level] >= LEVEL_RANK.info) {
      const entry: LogEntry = {
        id: row.id, ts: row.ts, level, scope, message,
        listingId: row.listingId, jobId: row.jobId, marketplaceId: row.marketplaceId as MarketplaceId | null,
        data: row.data ?? null,
      };
      events.publish({ type: 'log', entry });
    }
  } catch { /* the DB may be closing; never throw from the logger */ }
}

export const logger = {
  debug: (scope: string, message: string, ctx?: LogCtx) => write('debug', scope, message, ctx),
  info: (scope: string, message: string, ctx?: LogCtx) => write('info', scope, message, ctx),
  warn: (scope: string, message: string, ctx?: LogCtx) => write('warn', scope, message, ctx),
  error: (scope: string, message: string, ctx?: LogCtx) => write('error', scope, message, ctx),
};

export function initLogger(db: Db): void {
  dbRef = db;
}

/** Stop writing to the DB and close the current file (tests, shutdown). */
export function closeLogger(): void {
  dbRef = null;
  stream?.ws.end();
  stream = null;
}

export function purgeOldLogs(db: Db, days: number): void {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  db.delete(logs).where(and(lt(logs.ts, cutoff.toISOString()))).run();
  try {
    const cutoffDay = localParts(cutoff).day;
    for (const f of fs.readdirSync(paths.logsDir)) {
      const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1]! < cutoffDay) fs.rmSync(path.join(paths.logsDir, f), { force: true });
    }
  } catch { /* logs dir may not exist yet */ }
}
