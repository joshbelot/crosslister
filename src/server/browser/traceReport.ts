import fs from 'node:fs';
import path from 'node:path';
import type { TraceEvent, TraceMeta } from './trace';

function readEvents(dir: string): TraceEvent[] {
  const file = path.join(dir, 'trace.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as TraceEvent; } catch { return null; } })
    .filter((e): e is TraceEvent => e !== null);
}

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export function buildTraceReport(dir: string): string {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as TraceMeta & { listing?: Record<string, unknown> };
  const events = readEvents(dir);
  const out: string[] = [];
  out.push(`# Trace ${meta.jobId} — ${meta.type} on ${meta.marketplaceId ?? '(none)'}`);
  out.push('');
  out.push(`- Result: **${meta.state ?? 'unfinished'}**${meta.errorCode ? ` (${meta.errorCode}: ${meta.errorMessage})` : ''}`);
  out.push(`- Started ${meta.startedAt}, finished ${meta.finishedAt ?? '—'}; app ${meta.appVersion}`);
  if (meta.missingFields?.length) out.push(`- Left for the user: ${meta.missingFields.join(', ')}`);
  out.push(`- Folder: ${dir}`);
  if (meta.input) { out.push('', '## Input', '', '```json', JSON.stringify(meta.input, null, 2), '```'); }

  // Steps
  const starts = events.filter((e) => e.kind === 'step.start');
  const ends = new Map(events.filter((e) => e.kind === 'step.end').map((e) => [e.seq as number, e]));
  out.push('', '## Steps', '', '| # | Step | Result | Time | Message |', '|---|---|---|---|---|');
  for (const s of starts) {
    const e = ends.get(s.seq as number);
    out.push(`| ${s.seq} | ${s.label} (\`${s.key}\`) | ${e?.state ?? 'running'} | ${e ? `${((e.ms - s.ms) / 1000).toFixed(1)} s` : ''} | ${fmt(e?.message ?? '').replace(/\|/g, '\\|')} |`);
  }

  // Detail for every step that did not finish 'done'
  for (const s of starts) {
    const e = ends.get(s.seq as number);
    if (e && e.state === 'done') continue;
    const inStep = events.filter((x) => x.ms >= s.ms && (!e || x.ms <= e.ms));
    out.push('', `## Step ${s.seq}: ${s.label} — ${e?.state ?? 'running'}`, '');
    if (e?.detail) out.push(`Error detail: \`${fmt(e.detail)}\``, '');
    for (const x of inStep) {
      if (x.kind === 'locator') {
        out.push(`- locator **${x.what}** → ${x.ok ? `found via \`${x.chosen}\`` : 'NOT FOUND'} after ${x.waitedMs} ms`);
        for (const c of (x.candidates as Array<{ desc: string; count: number; visible: number }>) ?? []) out.push(`  - \`${c.desc}\`: ${c.count} match(es), ${c.visible} visible`);
      } else if (x.kind === 'options') {
        out.push(`- options for **${x.what}**: wanted ${fmt(x.wanted)}, best ${x.match ? `${fmt((x.match as { option: string }).option)} (score ${(x.match as { score: number }).score})` : 'none'}`);
        out.push(`  - seen (${(x.seen as string[]).length}): ${(x.seen as string[]).slice(0, 60).map((o) => JSON.stringify(o)).join(', ')}`);
      } else if (x.kind === 'fill') {
        out.push(`- fill **${x.what}** via ${x.method}: wanted ${x.valueLength} chars, read back ${JSON.stringify(x.readBack)} → ${x.ok ? 'ok' : 'MISMATCH'}`);
      } else if (['click', 'upload', 'nav', 'console', 'request.failed', 'response.error', 'dialog', 'error', 'snapshot', 'snapshot.error'].includes(x.kind)) {
        const { t: _t, ms: _ms, kind, ...rest } = x;
        out.push(`- ${kind}: \`${JSON.stringify(rest)}\``);
      }
    }
  }

  // Needs-user rounds and what the user filled in
  const asks = events.filter((e) => e.kind === 'needs_user');
  if (asks.length) {
    out.push('', '## Waiting for the user', '');
    for (const a of asks) out.push(`- ${a.ms} ms: ${a.reason} — ${a.title}${a.missingFields ? ` (missing: ${fmt(a.missingFields)})` : ''}`);
    for (const a of events.filter((e) => e.kind === 'user.answer')) out.push(`- ${a.ms} ms: answered by ${a.by}${a.url ? ` (${a.url})` : ''}`);
    const filled = fs.readdirSync(path.join(dir, 'snapshots')).filter((f) => f.startsWith('user-filled-'));
    if (filled.length) out.push('', `What the form looked like after the user filled it in: ${filled.map((f) => `snapshots/${f}`).join(', ')}`);
  }

  // Page problems over the whole job
  const problems = events.filter((e) => ['console', 'request.failed', 'response.error', 'dialog'].includes(e.kind));
  if (problems.length) {
    out.push('', `## Page problems (${problems.length})`, '');
    for (const p of problems.slice(0, 80)) { const { t: _t, kind, ...rest } = p; out.push(`- ${kind}: \`${JSON.stringify(rest)}\``); }
  }

  out.push('', '## Snapshots', '');
  for (const s of events.filter((e) => e.kind === 'snapshot')) out.push(`- ${s.label} @ ${s.url}: ${Object.values(s.files as Record<string, string>).join(', ')}`);
  out.push('');
  return out.join('\n');
}

export function writeTraceReport(dir: string): string {
  const md = buildTraceReport(dir);
  fs.writeFileSync(path.join(dir, 'report.md'), md);
  return md;
}
