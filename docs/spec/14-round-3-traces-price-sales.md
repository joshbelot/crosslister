# 14 — Round 3: job traces, price changes, sales

Round 2 (M40–M43) is complete. This file is the build plan for round 3. Same rules as `README.md` in this folder: follow it literally, work milestone by milestone (**M44 → M49**), run `npm run typecheck && npm test` after each (and `npm run test:browser` when the milestone says so), commit as `M<n>: <title>`, update the "Current milestone" line in `CLAUDE.md`.

**Do not make design decisions.** Names, files, routes, columns, message strings, defaults and tests are given. If something does not compile against the installed library version, keep the described behavior, adapt the call, and add one line under "Decisions made during implementation" in `IMPLEMENTATION_SUMMARY.md`. Where this file disagrees with files 01–13, this file wins.

## 0. Why

First real use (2026-10-15) on one listing ("Apple Magic Keyboard"):

| Marketplace | Result | What the logs said | Real cause |
|---|---|---|---|
| Poshmark | 7 of 11 fields left for the user | "Filling title … took too long", same for description and brand; category, condition, original price "not found" | After the photo upload Poshmark opens a **"Select a Covershot." dialog with Cancel / Apply**. The app never clicks Apply, so every later click lands on the dialog's backdrop and times out. Seen in `data/screenshots/dc1u95s26nh8-5-title.png`. Fixed in M45. |
| Mercari | category, brand, condition, weight left for the user | "needs the user: Category" (just the field name) | **Unknown.** Screenshots show only the top of the page (the fields are below the fold) and the log keeps no detail about which selectors were tried or what options the page offered. This is what M44 fixes. |

The user also asked for: price changes pushed to every marketplace (M46), a table of sold items with all sale details (M47), and a sale listener that removes the item everywhere else when it sells (M48).

### Decision recorded (user, 2026-10-15)

Round 1 said browser marketplaces are never checked on a timer. The user now wants sales detected automatically. Browser marketplaces are therefore checked on a timer **only** as specified in M48: opt-out setting, at most once per interval (default 60 minutes), at most 20 item pages per marketplace per round, with 5–10 s between pages, in a temporary background tab. No other polling is added.

### Milestones

| # | Milestone | Section |
|---|---|---|
| M44 | Job traces (detailed recording of every job) | §1 |
| M45 | Trace report command + Poshmark covershot fix | §2 |
| M46 | Change price everywhere | §3 |
| M47 | Sales table and Sold page | §4 |
| M48 | Sale listener and automatic delisting | §5 |
| M49 | Round 3 docs | §6 |

---

## 1. M44 — Job traces

Every job (publish, update, deactivate, connect, status check, import) writes a folder that explains, after the fact, exactly what happened: every selector tried, every option list seen, every value typed and read back, every navigation, console error and failed request, and a full-page screenshot + HTML + accessibility snapshot + list of form controls at the end of every step. A `report.md` is generated at the end so it can be pasted to Claude for analysis.

### 1.1 Settings

`src/shared/types.ts`, interface `Settings` — add:

```ts
  diagnostics: { recordTraces: boolean; keepTraceDays: number };
```

`src/shared/schemas.ts`, `settingsSchema` — add after `statusChecks`:

```ts
  diagnostics: z.object({
    recordTraces: z.boolean(),
    keepTraceDays: z.number().int().min(1).max(365),
  }),
```

`src/server/services/settings.ts`, `DEFAULT_SETTINGS` — add after `statusChecks`:

```ts
  diagnostics: { recordTraces: true, keepTraceDays: 30 },
```

`getSettings` already deep-merges defaults, so existing databases get the new block. Update any test that compares the full settings object (`grep -rn "statusChecks" tests`) to include `diagnostics: { recordTraces: true, keepTraceDays: 30 }`.

UI — `src/web/components/settings/GeneralTab.tsx`, add a new `<section>` after the `Browser` section:

```tsx
      <section>
        <h3 className="mb-3 font-semibold">Diagnostics</h3>
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={d.diagnostics.recordTraces} onChange={(v) => s.update((x) => { x.diagnostics.recordTraces = v; return x; })} label="Record a detailed trace of every job" />
          Record a detailed trace of every job
        </label>
        <p className="help">Screenshots, page snapshots and every step the app tried, saved in data/traces/. Use them to find out why a field wasn't filled.</p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          Delete traces older than
          <input className="input h-9 w-20" type="number" min={1} max={365} value={d.diagnostics.keepTraceDays} aria-label="Trace days"
            onChange={(e) => s.update((x) => { x.diagnostics.keepTraceDays = Math.min(365, Math.max(1, Math.round(Number(e.target.value)) || 1)); return x; })} /> days
        </div>
      </section>
```

(Import `Toggle` from `./Toggle` if `GeneralTab.tsx` does not already.)

### 1.2 Paths

`src/server/paths.ts` — add to `paths`: `tracesDir: path.join(config.dataDir, 'traces'),` and add the export:

```ts
export const traceDir = (jobId: string) => path.join(paths.tracesDir, jobId);
```

### 1.3 New file `src/server/browser/trace.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { ConsoleMessage, Dialog, Frame, Page, Request, Response } from 'playwright';
import { traceDir } from '../paths';

/** One line of trace.jsonl. */
export interface TraceEvent { t: string; ms: number; kind: string; [k: string]: unknown }

const active = new WeakMap<Page, JobTrace>();

/** The trace recording the job that currently drives `page`, if any. */
export function traceFor(page: Page): JobTrace | null { return active.get(page) ?? null; }

/** Record an event for whatever job drives `page`. Never throws. */
export function traceEvent(page: Page, kind: string, data: Record<string, unknown> = {}): void {
  try { active.get(page)?.event(kind, data); } catch { /* tracing must never break a job */ }
}

/** Short text for a locator candidate, e.g. `label=/description/i` or `css=input[type=file]`. */
export function describeCandidate(c: Record<string, unknown>): string {
  return Object.entries(c).map(([k, v]) => `${k}=${v instanceof RegExp ? v.toString() : JSON.stringify(v)}`).join(' ');
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const safe = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);

/** Runs inside the page. Lists the form controls on the page with every label-ish text that could be used to find them. */
export const CONTROL_INVENTORY = `(() => {
  const SEL = 'input, select, textarea, button, [role=button], [role=combobox], [role=listbox], [role=option], [role=radio], [role=radiogroup], [role=checkbox], [role=menuitem], [role=switch], [role=dialog], [contenteditable=""], [contenteditable=true]';
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '');
  const nearText = (el) => {
    let n = el;
    for (let i = 0; i < 4 && n; i++) {
      n = n.parentElement;
      if (!n) break;
      const lab = n.querySelector('label, legend, h1, h2, h3, h4, h5, h6, [class*="label" i], [class*="title" i]');
      if (lab && !lab.contains(el) && txt(lab)) return txt(lab);
    }
    return '';
  };
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let n = el;
    for (let i = 0; i < 3 && n && n.nodeType === 1; i++) {
      let p = n.tagName.toLowerCase();
      const cls = (n.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const out = [];
  for (const el of Array.from(document.querySelectorAll(SEL)).slice(0, 400)) {
    const r = el.getBoundingClientRect();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => txt(document.getElementById(id))).filter(Boolean).join(' ');
    let value = null;
    if (type !== 'password') {
      if (el.tagName === 'SELECT') value = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
      else if ('value' in el && typeof el.value === 'string') value = el.value.slice(0, 120);
      else if (el.isContentEditable) value = txt(el);
    }
    out.push({
      tag: el.tagName.toLowerCase(), type: type || null, role: el.getAttribute('role'), id: el.id || null, name: el.getAttribute('name'),
      ariaLabel: el.getAttribute('aria-label'), labelledBy: labelledBy || null,
      labels: el.labels ? Array.from(el.labels).map(txt).filter(Boolean) : [],
      placeholder: el.getAttribute('placeholder'),
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-et-name') || el.getAttribute('data-qa'),
      text: ['BUTTON', 'OPTION'].includes(el.tagName) || el.getAttribute('role') ? txt(el) : '',
      near: nearText(el), value,
      checked: 'checked' in el ? !!el.checked : (el.getAttribute('aria-checked') || el.getAttribute('aria-selected')),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      visible: !!(r.width || r.height) && getComputedStyle(el).visibility !== 'hidden',
      y: Math.round(r.top + window.scrollY), css: cssPath(el),
    });
  }
  return out;
})()`;

export interface TraceMeta {
  jobId: string; type: string; marketplaceId: string | null; listingId: string | null;
  startedAt: string; finishedAt?: string; state?: string; errorCode?: string | null; errorMessage?: string | null;
  missingFields?: string[]; input?: unknown; appVersion: string;
}

export class JobTrace {
  readonly dir: string;
  private readonly started = Date.now();
  private readonly stream: fs.WriteStream;
  private page: Page | null = null;
  private detachFns: Array<() => void> = [];
  private snapCount = 0;
  private needsUserTimer: NodeJS.Timeout | null = null;
  meta: TraceMeta;

  /** `skipDomOn`: no HTML/accessibility/control snapshots while the page URL matches (login pages). */
  constructor(meta: Omit<TraceMeta, 'startedAt' | 'appVersion'>, private readonly skipDomOn: RegExp | null) {
    this.dir = traceDir(meta.jobId);
    fs.mkdirSync(path.join(this.dir, 'snapshots'), { recursive: true });
    this.stream = fs.createWriteStream(path.join(this.dir, 'trace.jsonl'), { flags: 'a' });
    this.meta = { ...meta, startedAt: new Date().toISOString(), appVersion: process.env.npm_package_version ?? 'unknown' };
    this.writeMeta();
  }

  event(kind: string, data: Record<string, unknown> = {}): void {
    const ev: TraceEvent = { t: new Date().toISOString(), ms: Date.now() - this.started, kind, ...data };
    this.stream.write(JSON.stringify(ev) + '\n');
  }

  /** Start recording `page`'s navigations, console errors, failed requests, HTTP errors and dialogs. Idempotent. */
  attach(page: Page): void {
    if (this.page === page) return;
    this.detachPage();
    this.page = page;
    active.set(page, this);
    const onNav = (f: Frame) => { if (f === page.mainFrame()) this.event('nav', { url: f.url() }); };
    const onConsole = (m: ConsoleMessage) => { if (m.type() === 'error' || m.type() === 'warning') this.event('console', { level: m.type(), text: short(m.text(), 500) }); };
    const onReqFailed = (r: Request) => this.event('request.failed', { method: r.method(), url: short(r.url(), 300), resource: r.resourceType(), failure: r.failure()?.errorText ?? null });
    const onResponse = (r: Response) => { if (r.status() >= 400) this.event('response.error', { status: r.status(), url: short(r.url(), 300), resource: r.request().resourceType() }); };
    const onDialog = (d: Dialog) => this.event('dialog', { type: d.type(), message: short(d.message(), 300) });
    page.on('framenavigated', onNav); page.on('console', onConsole); page.on('requestfailed', onReqFailed);
    page.on('response', onResponse); page.on('dialog', onDialog);
    this.detachFns.push(() => {
      page.off('framenavigated', onNav); page.off('console', onConsole); page.off('requestfailed', onReqFailed);
      page.off('response', onResponse); page.off('dialog', onDialog);
      if (active.get(page) === this) active.delete(page);
    });
    this.event('page.attached', { url: page.url() });
  }

  private detachPage(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.page = null;
  }

  /** Full-page screenshot + HTML + accessibility tree + control inventory. Never throws; gives up after ~20 s. */
  async snapshot(label: string): Promise<string | null> {
    const page = this.page;
    if (!page || page.isClosed()) return null;
    const base = path.join(this.dir, 'snapshots', `${String(++this.snapCount).padStart(3, '0')}-${safe(label)}`);
    const files: Record<string, string> = {};
    const url = page.url();
    const dom = !(this.skipDomOn && this.skipDomOn.test(url));
    try { await page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 10_000 }); files.png = `${base}.png`; } catch (err) { this.event('snapshot.error', { label, what: 'screenshot', error: short(String((err as Error).message), 200) }); }
    if (dom) {
      try { fs.writeFileSync(`${base}.html`, await page.content()); files.html = `${base}.html`; } catch { /* page navigating */ }
      try { fs.writeFileSync(`${base}.aria.yml`, await page.locator('body').ariaSnapshot({ timeout: 5000 })); files.aria = `${base}.aria.yml`; } catch { /* not supported or timed out */ }
      try { fs.writeFileSync(`${base}.controls.json`, JSON.stringify(await page.evaluate(CONTROL_INVENTORY), null, 1)); files.controls = `${base}.controls.json`; } catch { /* page navigating */ }
    }
    this.event('snapshot', { label, url, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, path.relative(this.dir, v)])) });
    return files.png ?? null;
  }

  /** While the job waits for the user, keep the latest control inventory of the form, so the trace shows what the user filled in by hand. */
  startNeedsUserWatch(): void {
    this.stopNeedsUserWatch();
    const page = this.page;
    if (!page) return;
    const startUrl = page.url();
    const file = path.join(this.dir, 'snapshots', `user-filled-${String(this.snapCount).padStart(3, '0')}.controls.json`);
    this.needsUserTimer = setInterval(() => {
      if (page.isClosed() || page.url() !== startUrl) return;
      if (this.skipDomOn && this.skipDomOn.test(startUrl)) return;
      page.evaluate(CONTROL_INVENTORY).then((inv) => fs.writeFileSync(file, JSON.stringify(inv, null, 1))).catch(() => { /* navigating */ });
    }, 5000);
    this.needsUserTimer.unref();
  }

  stopNeedsUserWatch(): void {
    if (this.needsUserTimer) clearInterval(this.needsUserTimer);
    this.needsUserTimer = null;
  }

  writeMeta(): void {
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2));
  }

  /** Final snapshot, meta.json, report.md; stops recording. */
  async finish(result: { state: string; errorCode: string | null; errorMessage: string | null; missingFields: string[] }): Promise<void> {
    this.stopNeedsUserWatch();
    await this.snapshot('final');
    this.meta = { ...this.meta, ...result, finishedAt: new Date().toISOString() };
    this.event('job.end', { ...result });
    this.writeMeta();
    this.detachPage();
    await new Promise<void>((r) => this.stream.end(r));
    try {
      const { writeTraceReport } = await import('./traceReport');
      writeTraceReport(this.dir);
    } catch (err) {
      fs.writeFileSync(path.join(this.dir, 'report-error.txt'), String((err as Error).stack ?? err));
    }
  }
}
```

### 1.4 New file `src/server/browser/traceReport.ts`

Builds `report.md` from a trace folder. Pure file reading — no app imports, so the CLI in M45 can use it.

```ts
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
```

### 1.5 Recording from the browser helpers

**`src/server/browser/locators.ts`** — `resolveLocator` records what it tried. Replace the function body with:

```ts
  const state = opts.state ?? 'visible';
  const page = 'page' in scope && typeof (scope as Locator).page === 'function' ? (scope as Locator).page() : (scope as Page);
  const started = Date.now();
  const loc = combinedLocator(scope, spec).first();
  const report = async (chosen: string | null) => {
    if (!traceFor(page)) return;
    const candidates = [];
    for (const c of spec.candidates) {
      const base = toLocator(scope, c);
      candidates.push({
        desc: describeCandidate(c as Record<string, unknown>),
        count: await base.count().catch(() => -1),
        visible: await base.filter({ visible: true }).count().catch(() => -1),
      });
    }
    traceEvent(page, 'locator', { what: spec.what, state, ok: chosen !== null, chosen, waitedMs: Date.now() - started, candidates });
  };
  try {
    await loc.waitFor({ state, timeout: opts.timeoutMs ?? 6000 });
  } catch {
    await report(null);
    throw adapterError('ELEMENT_NOT_FOUND', null, { what: spec.what });
  }
  // `.or()` yields DOM order; honor the candidate order (earlier = preferred) among the ones that are present.
  for (const c of spec.candidates) {
    const base = toLocator(scope, c);
    const one = state === 'visible' ? base.filter({ visible: true }).first() : base.first();
    if ((await one.count().catch(() => 0)) > 0) { await report(describeCandidate(c as Record<string, unknown>)); return one; }
  }
  await report('combined');
  return loc;
```

Add `import { describeCandidate, traceEvent, traceFor } from './trace';`. Note: `exists()` calls `resolveLocator`, so probes that are *expected* to fail (e.g. the challenge check) are recorded too; that is intended.

**`src/server/browser/actions.ts`** — add `import { traceEvent } from './trace';` and these calls (do not change any other logic):

| Function | Add |
|---|---|
| `click` | after `await loc.click();`: `traceEvent(page, 'click', { what: spec.what });` |
| `fillText` | before each `return` after a successful read-back, and before the `throw`, record: `traceEvent(page, 'fill', { what: spec.what, method, valueLength: value.length, readBack: (await read()).slice(0, 120), ok })` where `method` is `'insertText'` / `'fill'` for the first attempt and `'pressSequentially'` for the second, and `ok` is whether it matched. Keep the existing control flow: compute `const got = await read();` once per attempt and use it for both the comparison and the event. |
| `uploadFiles` | after `setInputFiles`: `traceEvent(page, 'upload', { what: spec.what, files: files.length });` and before the `UPLOAD_FAILED` throw: `traceEvent(page, 'upload.timeout', { what: spec.what, files: files.length, previews: await previews.count() });` |
| `pickFromScope` | right after `const match = bestMatch(...)`: `traceEvent(page, 'options', { what, wanted: Array.isArray(wanted) ? wanted : [wanted], seen: options.map((o) => o.text).slice(0, 200), match });` |
| `chooseOption` (`SELECT` branch) | right after its `bestMatch`: `traceEvent(page, 'options', { what: trigger.what, wanted: Array.isArray(wanted) ? wanted : [wanted], seen: texts.slice(0, 200), match });` |
| `chooseRadio` | right after its `bestMatch`: `traceEvent(page, 'options', { what: group.what, wanted: Array.isArray(wanted) ? wanted : [wanted], seen: usable.map((i) => i.text).slice(0, 200), match });` |
| `typeahead` | when `allowCustom` makes it press Enter: `traceEvent(page, 'typeahead.custom', { what: input.what, value });` |

### 1.6 Wiring the trace into the job — `src/server/services/jobContext.ts`

1. `JobContext` interface — add:

```ts
  /** The job's trace, or null when traces are off. */
  trace: JobTrace | null;
  /** Called once by the job runner when the job is over. */
  finishTrace(result: { state: string; errorCode: string | null; errorMessage: string | null }): Promise<void>;
```

2. In `createJobContext`, before `const ctx: JobContext = {`:

```ts
  const adapterForTrace = (() => { try { return getAdapter(mp); } catch { return null; } })();
  const loginPattern = adapterForTrace && adapterForTrace.kind === 'browser' ? (adapterForTrace as BrowserAdapter).auth.loginUrlPattern : null;
  const trace = settings.diagnostics.recordTraces
    ? new JobTrace({ jobId: job.id, type: job.type, marketplaceId: job.marketplaceId, listingId: job.listingId, input: getJobRow(db, job.id).input }, loginPattern)
    : null;
```

Imports: `JobTrace` from `'../browser/trace'`, `BrowserAdapter` type from `'../marketplaces/types'`, `getJobRow` from `'./jobs'`.

3. In `step` and `tryStep`: right after `currentStepId = step.id;` add `trace?.event('step.start', { seq: step.seq, key, label });`. On every exit path add one event and one snapshot **before** `finishStep(...)` is called:
   - success: `trace?.event('step.end', { seq: step.seq, key, state: 'done' }); await trace?.snapshot(`${key}-done`);`
   - failure / needs_user: `trace?.event('step.end', { seq: step.seq, key, state: <'failed' | 'needs_user'>, message: <the message passed to finishStep>, detail: e.detail ?? e.message, code: e.code }); await trace?.snapshot(`${key}-${<state>}`);`
   - In `step`'s catch, also record `trace?.event('error', { code: e.code, message: e.userMessage, detail: e.detail ?? null, stack: String((err as Error)?.stack ?? '').split('\n').slice(0, 8).join('\n') });`
   - For `CANCELLED`, record `step.end` with state `'failed'` but skip the snapshot.

4. In `requestUserUntil`, after `notifyUser(...)`: `trace?.event('needs_user', { reason: req.reason, title: req.title, missingFields: req.missingFields ?? null }); await trace?.snapshot('needs-user'); trace?.startNeedsUserWatch();`. After `const result = await Promise.race(...)`: `trace?.event('user.answer', { by: result.by, url: result.by === 'user' ? result.url : null });`. In the `finally`: `trace?.stopNeedsUserWatch();`.

5. Replace `page: () => browserManager.getPage(mp),` with:

```ts
    page: async () => {
      const p = await browserManager.getPage(mp);
      trace?.attach(p);
      return p;
    },
```

6. Add to the `ctx` object: `trace,` and

```ts
    async finishTrace(result) {
      if (!trace) return;
      try { await trace.finish({ ...result, missingFields: [...ctx.missingFields] }); } catch { /* never break the job */ }
    },
```

7. **Listing snapshot in the trace.** In `src/server/services/jobRunner.ts`, in the `publish`/`update` branch right after `eff.photoPaths = await ctx.step(...)`, add:

```ts
      if (ctx.trace) {
        const { photoPaths, ...rest } = eff;
        ctx.trace.meta = { ...ctx.trace.meta, listing: { ...rest, photoCount: photoPaths.length, mapping: adapter.describeMapping(eff) } } as typeof ctx.trace.meta;
        ctx.trace.writeMeta();
      }
```

Add `listing?: Record<string, unknown>` to `TraceMeta` so this type-checks without the cast if you prefer; either is fine.

8. In `executeJob`'s `finally` block, **first line**:

```ts
    const final = getJob(db, queued.id);
    await ctx.finishTrace({ state: final.state, errorCode: final.errorCode, errorMessage: final.errorMessage });
```

### 1.7 Cleanup of old traces

New file `src/server/services/traces.ts`:

```ts
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
```

Register it by adding `import '../services/traces';` to `src/server/routes/sales.ts` next to its existing `import { createStatusChecks } from '../services/statusChecks';` (that import is what registers the status-check tick today).

### 1.8 API and UI

`src/server/routes/jobs.ts` — add:

```ts
  app.get('/jobs/:id/trace/report', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const file = path.join(traceDir(id), 'report.md');
    if (!fs.existsSync(file)) throw notFound('Trace');
    return reply.type('text/markdown; charset=utf-8').send(fs.readFileSync(file, 'utf8'));
  });

  app.get('/jobs/:id/trace.zip', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const dir = traceDir(id);
    if (!fs.existsSync(dir)) throw notFound('Trace');
    reply.header('content-disposition', `attachment; filename="crosslister-trace-${id}.zip"`);
    return reply.type('application/zip').send(zipDirectory(dir));
  });

  app.post('/jobs/:id/trace/open', async (req) => {
    const { id } = idParam.parse(req.params);
    const dir = traceDir(id);
    if (!fs.existsSync(dir)) throw notFound('Trace');
    if (process.platform === 'darwin') execFile('open', [dir], () => { /* ignore */ });
    return { ok: true };
  });
```

`zipDirectory(dir): NodeJS.ReadableStream` — add it to `src/server/services/exporter.ts` using the same `archiver` `ZipArchive` usage that the ZIP backup already uses (`grep -n "ZipArchive" src/server`): create the archive, `archive.directory(dir, false)`, `archive.finalize()`, return the archive stream. Imports in `jobs.ts`: `path`, `execFile` from `node:child_process`, `traceDir` from `../paths`, `notFound` (already imported), `zipDirectory` from `../services/exporter`.

`Job` (shared type) — add `hasTrace?: boolean`. In the server function that builds a `Job` for the API (`getJob` / `rowToJob` in `src/server/services/jobs.ts` or `mappers.ts`), set `hasTrace: fs.existsSync(traceDir(row.id))`.

`src/web/components/JobCard.tsx` — when `job.hasTrace` and the job is in a terminal state (`SUCCESS`, `FAILED`, `CANCELLED`), add next to the existing buttons:

```tsx
            <a className="btn btn-secondary btn-sm" href={`/api/jobs/${job.id}/trace.zip`}>Download trace</a>
            <button className="btn btn-secondary btn-sm" onClick={() => void api.post(`/api/jobs/${job.id}/trace/open`, {})}>Show trace folder</button>
```

(Use whatever the existing `api` client exports for POST — `grep -n "export const api" src/web/api/client.ts`.)

### 1.9 Tests

1. `tests/browser/trace.test.ts` (browser test, `describe.skipIf(!process.env.RUN_BROWSER_TESTS)`): reuse the pattern of `tests/browser/mercari.test.ts` (same helpers, `startFlowEnv`, `createTestApp`, `setOverrides`, `fakeLogin`). Run the Mercari happy path once with `?missing=brand` on the sell URL so one optional step needs the user; answer it with `POST /continue` and a Mercari item URL. Then assert, reading `traceDir(jobId)`:
   - `meta.json` has `state: 'SUCCESS'` and `missingFields` containing the brand step label.
   - `trace.jsonl` contains at least one `locator` event with `ok: false` and `what` equal to the brand spec's `what`, with a `candidates` array whose length equals the number of candidates in `mercari/selectors.ts` `sel.brand`.
   - `trace.jsonl` contains a `fill` event with `ok: true` for the title.
   - `snapshots/` contains a `.png`, `.html` and `.controls.json` file for the brand step (`*-brand-needs_user.*`).
   - `report.md` exists and contains `NOT FOUND` and the brand spec's `what`.
2. `tests/server/traces.test.ts` (unit): create two fake folders in `paths.tracesDir`, set one folder's mtime 40 days back with `fs.utimesSync`, call `purgeOldTraces(t.db, Date.now(), true)` with default settings → only the old one is removed.
3. `tests/server/traceReport.test.ts` (unit): write a small `meta.json` + `trace.jsonl` (one `step.start`/`step.end` pair with `state: 'needs_user'`, one `locator` event with `ok: false`, one `options` event) into a temp folder with an empty `snapshots/` subfolder; `buildTraceReport(dir)` contains the step label, `NOT FOUND`, and the first option text.
4. Existing tests that assert on job steps must still pass (traces are additive). In `tests/helpers/setupEnv.ts` nothing changes — traces go to the temp `data/` directory.

Done when: `npm run typecheck && npm test && npm run test:browser` pass.

---

## 2. M45 — Trace report command + Poshmark covershot fix

### 2.1 `npm run trace:report`

`package.json` scripts — add: `"trace:report": "tsx src/server/scripts/traceReport.ts"`.

New file `src/server/scripts/traceReport.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { buildTraceReport } from '../browser/traceReport';
import { paths } from '../paths';

const args = process.argv.slice(2);
const dirs = () => (fs.existsSync(paths.tracesDir) ? fs.readdirSync(paths.tracesDir) : [])
  .map((name) => ({ name, dir: path.join(paths.tracesDir, name) }))
  .filter((d) => fs.existsSync(path.join(d.dir, 'meta.json')))
  .map((d) => ({ ...d, meta: JSON.parse(fs.readFileSync(path.join(d.dir, 'meta.json'), 'utf8')) as { type: string; marketplaceId: string | null; state?: string; startedAt: string } }))
  .sort((a, b) => b.meta.startedAt.localeCompare(a.meta.startedAt));

if (args[0] === '--list' || args.length === 0) {
  for (const d of dirs().slice(0, 30)) console.log(`${d.name}  ${d.meta.startedAt}  ${d.meta.type.padEnd(12)} ${(d.meta.marketplaceId ?? '').padEnd(9)} ${d.meta.state ?? 'unfinished'}`);
  if (args.length === 0) console.log('\nUsage: npm run trace:report -- <jobId> | latest [marketplace] | --list');
  process.exit(0);
}

let target: string | undefined;
if (args[0] === 'latest') target = dirs().find((d) => !args[1] || d.meta.marketplaceId === args[1])?.dir;
else target = path.join(paths.tracesDir, args[0]!);
if (!target || !fs.existsSync(path.join(target, 'meta.json'))) { console.error('No such trace. Try: npm run trace:report -- --list'); process.exit(1); }
const md = buildTraceReport(target);
fs.writeFileSync(path.join(target, 'report.md'), md);
console.log(md);
```

### 2.2 Poshmark covershot dialog

`src/server/marketplaces/poshmark/selectors.ts` — add to `sel`:

```ts
  coverShotApply: {
    what: 'Covershot Apply button',
    candidates: [{ css: '[role="dialog"] button:text-is("Apply")' }, { role: 'button', name: /^apply$/i }],
  },
```

`src/server/marketplaces/poshmark/index.ts`, in `publish`'s `recipe.fields`, insert directly after the `photos` field:

```ts
        { key: 'coverShot', label: 'Confirming the cover photo', run: async (page) => {
          // Poshmark opens a "Select a Covershot." dialog after the upload; nothing else can be clicked until Apply is pressed.
          if (await exists(page, sel.coverShotApply, 8000)) {
            await click(page, sel.coverShotApply);
            await page.waitForTimeout(800);
          }
        } },
```

(`exists` and `click` are already imported in that file; if not, add them to the existing imports from `'../../browser/locators'` and `'../../browser/actions'`.) Add `sel.coverShotApply` to `selectorGroups.sell` right after `sel.photoInput`.

Fixture — `fixtures/marketplace-pages/poshmark/sell.html`:

1. Add before the closing `</body>` (above the existing `<script>` block):

```html
  <div id="cover-backdrop" hidden style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50">
    <div role="dialog" aria-label="Covershot" style="background:#fff;margin:80px auto;padding:16px;width:320px">
      <p>Select a Covershot.</p>
      <button type="button" id="cover-cancel">Cancel</button>
      <button type="button" id="cover-apply">Apply</button>
    </div>
  </div>
```

2. Inside the existing `<script>` block, after the `Fixture.uploads(...)` line:

```js
  if ($('photos')) $('photos').addEventListener('change', () => setTimeout(() => { if (!Fixture.params.get('nocover')) $('cover-backdrop').hidden = false; }, 600));
  $('cover-apply').addEventListener('click', () => { $('cover-backdrop').hidden = true; Fixture.record('coverShot', 'applied'); });
  $('cover-cancel').addEventListener('click', () => { $('cover-backdrop').hidden = true; });
```

3. In `tests/browser/poshmark.test.ts`, in the happy-path test's `readFilled` expectation add `coverShot: 'applied'`. The backdrop covers the whole form, so without the fix every later field would fail — the existing happy-path assertions prove the fix.

Done when: `npm run typecheck && npm test && npm run test:browser` pass, and `npm run trace:report -- --list` prints the traces in `data/traces/`.

---

## 3. M46 — Change price everywhere

### 3.1 Remember the price each marketplace actually has

`src/server/db/schema.ts`, table `marketplaceListings` — add after `priceOverrideCents`:

```ts
  listedPriceCents: integer('listed_price_cents'),
```

Run `npm run db:generate` and commit the new migration. `src/shared/types.ts` `MarketplaceListing` — add `listedPriceCents: number | null;`. Map it in `rowToMarketplaceListing` (`src/server/services/mappers.ts`).

Set it:

| Where | Value |
|---|---|
| `jobRunner.ts`, publish success `updateTarget(...)` | `listedPriceCents: eff.priceCents` |
| `jobRunner.ts`, update success `updateTarget(...)` | `listedPriceCents: eff.priceCents` **only when** the job's fields include `'price'` (see §3.2) |
| `marketplaceListings.ts` `markListed` | the effective price at that moment: build it with `buildEffectiveListing(rowToListing(listingRow), listPhotoRows(db, listingId), <the target as MarketplaceListing>, adapter, getSettings(db)).priceCents` (same call `sales.ts` `markSold` uses) |

### 3.2 Price-only updates

Update jobs get an optional input `fields: Array<'title' | 'description' | 'price'>`; missing means all three (today's behavior).

`src/server/marketplaces/common.ts` — add:

```ts
export type UpdateField = 'title' | 'description' | 'price';

/** Which fields an update job should push (job input `fields`; default all). */
export function updateFields(ctx: JobContext): UpdateField[] {
  const row = ctx.db.select().from(jobs).where(eq(jobs.id, ctx.job.id)).get();
  const f = (row?.input as { fields?: unknown } | null)?.fields;
  return Array.isArray(f) && f.length ? (f.filter((x) => x === 'title' || x === 'description' || x === 'price') as UpdateField[]) : ['title', 'description', 'price'];
}
```

(Imports: `jobs` from `'../db/schema'`, `eq` from `'drizzle-orm'`.)

In `runBrowserUpdate`, replace `for (const [i, f] of r.fields.entries()) {` with:

```ts
  const wanted = updateFields(ctx);
  const fields = r.fields.filter((f) => wanted.includes(f.key as UpdateField));
  for (const [i, f] of fields.entries()) {
```

and inside the loop use `fields.length` instead of `r.fields.length`. Replace the instruction text `'The title, description and price are updated. '` with:

```ts
`Updated: ${fields.map((f) => f.key).join(', ')}. `
```

eBay — `src/server/marketplaces/ebay/index.ts` `update`: build `inner` from the wanted fields:

```ts
      const wanted = updateFields(ctx);
      const inner = `<Item><ItemID>${escapeXml(id)}</ItemID>`
        + (wanted.includes('title') ? `<Title>${escapeXml(l.title)}</Title>` : '')
        + (wanted.includes('description') ? `<Description>${cdata(descriptionToHtml(l.description))}</Description>` : '')
        + (wanted.includes('price') ? `<StartPrice currencyID="USD">${((l.priceCents ?? 0) / 100).toFixed(2)}</StartPrice>` : '')
        + '</Item>';
```

`jobRunner.ts` update branch: after `await adapter.update(ctx, eff, ml);` compute `const pushed = updateFields(ctx);` and pass `...(pushed.includes('price') ? { listedPriceCents: eff.priceCents } : {})` into the existing `updateTarget` call.

### 3.3 Service — new file `src/server/services/priceChange.ts`

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { Job, ListingDetail } from '../../shared/types';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import { buildEffectiveListing } from './effectiveListing';
import { createJob } from './jobs';
import { jobRunner } from './jobRunner';
import { getListing } from './listings';
import { logger } from './logger';
import { rowToListing, rowToMarketplaceListing } from './mappers';
import { listPhotoRows } from './photos';
import { getSettings } from './settings';

export interface PriceChangeRow {
  marketplaceId: MarketplaceId;
  name: string;
  kind: 'api' | 'browser' | 'manual';
  currentPriceCents: number | null;   // what the marketplace has now (listedPriceCents, else the current effective price)
  newPriceCents: number | null;       // effective price after the change
  hasOverride: boolean;               // a per-marketplace price override exists
  canPush: boolean;                   // the app can change it there (update job)
  note: string | null;                // why it can't, or a warning
  url: string | null;
}

function effectivePrice(db: Db, listingRow: typeof listings.$inferSelect, mlRow: typeof marketplaceListings.$inferSelect, priceCents: number, clearOverride: boolean): number | null {
  const mp = mlRow.marketplaceId as MarketplaceId;
  const ml = rowToMarketplaceListing({ ...mlRow, priceOverrideCents: clearOverride ? null : mlRow.priceOverrideCents });
  return buildEffectiveListing(rowToListing({ ...listingRow, priceCents }), listPhotoRows(db, listingRow.id), ml, getAdapter(mp), getSettings(db)).priceCents;
}

export function previewPriceChange(db: Db, listingId: string, priceCents: number, clearOverrides: boolean): PriceChangeRow[] {
  const listingRow = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listingRow) throw notFound('Listing');
  const active = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.status, 'active'))).all();
  return active.map((row) => {
    const mp = row.marketplaceId as MarketplaceId;
    const adapter = getAdapter(mp);
    const newPrice = effectivePrice(db, listingRow, row, priceCents, clearOverrides);
    const current = row.listedPriceCents ?? effectivePrice(db, listingRow, row, listingRow.priceCents ?? 0, false);
    const canUpdate = adapter.capabilities.update !== 'none' && adapter.capabilities.update !== 'manual' && typeof adapter.update === 'function';
    let note: string | null = null;
    let canPush = canUpdate;
    if (!canUpdate) note = `Change it yourself on ${adapter.name}.`;
    if (newPrice !== null && newPrice < adapter.capabilities.minPriceCents) { canPush = false; note = `Below ${adapter.name}'s minimum price.`; }
    if (row.priceOverrideCents !== null && !clearOverrides) note = note ?? `Has its own price (${(row.priceOverrideCents / 100).toFixed(2)}), which stays.`;
    return {
      marketplaceId: mp, name: MARKETPLACE_NAMES[mp], kind: adapter.kind, currentPriceCents: current, newPriceCents: newPrice,
      hasOverride: row.priceOverrideCents !== null, canPush, note, url: row.url,
    };
  });
}

export function applyPriceChange(db: Db, listingId: string, body: { priceCents: number; marketplaceIds: MarketplaceId[]; clearOverrides: boolean }):
  { listing: ListingDetail; jobs: Job[]; skipped: Array<{ marketplaceId: MarketplaceId; reason: string }> } {
  const listingRow = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listingRow) throw notFound('Listing');
  if (listingRow.soldAt) throw new AppError('ALREADY_SOLD', 409, 'This item is marked as sold.');
  const rows = previewPriceChange(db, listingId, body.priceCents, body.clearOverrides);
  const now = new Date().toISOString();
  db.update(listings).set({ priceCents: body.priceCents, updatedAt: now }).where(eq(listings.id, listingId)).run();
  if (body.clearOverrides && body.marketplaceIds.length) {
    db.update(marketplaceListings).set({ priceOverrideCents: null, updatedAt: now })
      .where(and(eq(marketplaceListings.listingId, listingId), inArray(marketplaceListings.marketplaceId, body.marketplaceIds))).run();
  }
  const created: Job[] = [];
  const skipped: Array<{ marketplaceId: MarketplaceId; reason: string }> = [];
  for (const mp of body.marketplaceIds) {
    const r = rows.find((x) => x.marketplaceId === mp);
    if (!r) { skipped.push({ marketplaceId: mp, reason: 'Not listed there' }); continue; }
    if (!r.canPush) { skipped.push({ marketplaceId: mp, reason: r.note ?? 'Not supported' }); continue; }
    const open = db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.listingId, listingId), eq(jobs.marketplaceId, mp), eq(jobs.type, 'update'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']),
    )).get();
    if (open) { skipped.push({ marketplaceId: mp, reason: 'An update is already running' }); continue; }
    created.push(createJob(db, { type: 'update', marketplaceId: mp, listingId, input: { previousStatus: 'active', fields: ['price'] } }));
  }
  logger.info('JOBS', `Price change to ${(body.priceCents / 100).toFixed(2)}: ${created.length} update job(s), ${skipped.length} skipped`, { listingId });
  jobRunner.kick();
  return { listing: getListing(db, listingId), jobs: created, skipped };
}
```

If `createJob`'s input type does not accept `fields`, widen it to `Record<string, unknown>` (it is stored as JSON).

### 3.4 Schema and routes

`src/shared/schemas.ts`:

```ts
export const priceChangeSchema = z.object({
  priceCents: z.number().int().min(1),
  marketplaceIds: z.array(marketplaceIdSchema).default([]),
  clearOverrides: z.boolean().default(false),
});
```

New file `src/server/routes/priceChange.ts`, registered in `app.ts` after `salesRoutes`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { priceChangeSchema } from '../../shared/schemas';
import { applyPriceChange, previewPriceChange } from '../services/priceChange';

const idParam = z.object({ id: z.string() });

export async function priceChangeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/listings/:id/price-change/preview', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ priceCents: z.coerce.number().int().min(1), clearOverrides: z.enum(['0', '1']).default('0') }).parse(req.query);
    return { items: previewPriceChange(app.db, id, q.priceCents, q.clearOverrides === '1') };
  });
  app.post('/listings/:id/price-change', async (req) => {
    const { id } = idParam.parse(req.params);
    return applyPriceChange(app.db, id, priceChangeSchema.parse(req.body));
  });
}
```

### 3.5 UI — new `src/web/components/PriceChangeModal.tsx`

Props: `{ listing: ListingDetail; onClose: () => void }`. Layout (use the existing `Modal`, `PriceInput`, `api`, `toast`, `setUi` the same way `MarkSoldModal.tsx` does):

- Title: **Change price**.
- Line: `Current price: $X` (from `listing.priceCents`).
- `PriceInput` labelled **New price**, initial value = current price.
- Row of buttons **−5%**, **−10%**, **−15%**, **−20%**: each sets new price to `Math.round(current * (1 - p/100))` cents, then rounded to whole dollars **if** `listing.marketplaces` contains an active Poshmark listing (Poshmark prices are whole dollars), otherwise to cents.
- When any active marketplace listing has an override: checkbox **Also replace prices you set per marketplace** (`clearOverrides`, default off).
- Table fetched from `GET /api/listings/:id/price-change/preview?priceCents=…&clearOverrides=0|1` (refetch on change, debounced 300 ms): columns ☐ (checked by default when `canPush`; disabled when not), **Marketplace**, **Now**, **New**, **Note**. When `kind === 'manual'` and `url`, the note includes an **Open** link to `url`.
- If there are no active marketplaces: text "Not listed anywhere yet — this only changes the price in Crosslister."
- Footer: **Cancel**, primary **Save and update N marketplaces** (N = checked rows; when N = 0 the label is **Save price**). On success: close, `toast.success('Price saved')`, open the Activity drawer when jobs were created, `toast.info('<Name>: <reason>')` for each skipped item, invalidate the listing query.

Open it from:
- `src/web/pages/ListingDetailPage.tsx`: a **Change price** button in the action bar, right before **Mark Sold**; hidden when the listing is sold.
- `src/web/pages/InventoryPage.tsx`: if inventory rows have a per-row menu, add **Change price…** to it; if not, skip this entry point.

### 3.6 Tests — `tests/listings/priceChange.test.ts`

Use `createTestApp`, `seedListing` and the fake adapters from `tests/helpers/fakeAdapter.ts` the way `tests/jobs/update.test.ts` does. Cases:

1. Preview: listing at 5000 active on a fake browser adapter with `update` (no override) and on the manual adapter `vinted`; preview with 4000 → the fake row has `newPriceCents` 4000 (with default 0 % adjustment) and `canPush: true`; the Vinted row has `canPush: false` and a note containing "yourself".
2. Apply: creates exactly one `update` job with input `fields: ['price']`; the listing's `priceCents` is 4000.
3. After the runner finishes the job, the fake marketplace row's `listedPriceCents` is 4000.
4. Override kept: set `priceOverrideCents` 6000 on the fake row; preview with 4000 and `clearOverrides=0` → `newPriceCents` 6000 and a note; with `clearOverrides=1` → 4000; apply with `clearOverrides: true` clears the override.
5. Sold listing → 409 `ALREADY_SOLD`.
6. `runBrowserUpdate` with `fields: ['price']` fills only price: add to `tests/browser/update.test.ts` one case that creates the update job via `POST /api/listings/:id/price-change` and asserts the fixture's recorded edit has the new price and does **not** contain a `title` key.

Done when: `npm run typecheck && npm test && npm run test:browser` pass.

---

## 4. M47 — Sales table and Sold page

### 4.1 Table

`src/server/db/schema.ts` — new table:

```ts
export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  marketplaceId: text('marketplace_id').notNull(),               // a MarketplaceId or 'elsewhere'
  soldAt: text('sold_at').notNull(),
  title: text('title').notNull(),                                 // copied from the listing at sale time
  sku: text('sku').notNull(),
  salePriceCents: integer('sale_price_cents'),
  shippingChargedCents: integer('shipping_charged_cents'),        // what the buyer paid for shipping
  marketplaceFeesCents: integer('marketplace_fees_cents'),
  shippingCostCents: integer('shipping_cost_cents'),              // what you paid for the label
  otherCostsCents: integer('other_costs_cents'),
  itemCostCents: integer('item_cost_cents'),                      // copied from listings.cost_cents
  buyer: text('buyer').notNull().default(''),
  orderUrl: text('order_url'),
  notes: text('notes').notNull().default(''),
  source: text('source').notNull(),                               // 'manual' | 'detected' | 'ebay_api'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [index('sales_sold_at_idx').on(t.soldAt), index('sales_listing_idx').on(t.listingId)]);
```

Run `npm run db:generate`; commit the migration.

`src/shared/types.ts`:

```ts
export interface Sale {
  id: string; listingId: string | null; marketplaceId: MarketplaceId | 'elsewhere'; soldAt: string;
  title: string; sku: string; thumbUrl: string | null;
  salePriceCents: number | null; shippingChargedCents: number | null; marketplaceFeesCents: number | null;
  shippingCostCents: number | null; otherCostsCents: number | null; itemCostCents: number | null;
  netCents: number | null;   // sale + shipping charged − fees − shipping cost − other costs − item cost; null when salePriceCents is null
  buyer: string; orderUrl: string | null; notes: string; source: 'manual' | 'detected' | 'ebay_api';
  createdAt: string; updatedAt: string;
}
export interface SalesTotals { count: number; revenueCents: number; feesCents: number; netCents: number }
```

`netCents` treats a `null` part as 0. `thumbUrl` is the primary photo's thumb URL of the listing (same URL format the inventory uses), or null.

### 4.2 Service — new file `src/server/services/salesLedger.ts`

Functions (all synchronous, drizzle like the rest):

- `createSale(db, input: { listingId: string; marketplaceId: MarketplaceId | 'elsewhere'; soldAt: string; salePriceCents: number | null; source: Sale['source']; shippingChargedCents?: number | null; marketplaceFeesCents?: number | null; shippingCostCents?: number | null; otherCostsCents?: number | null; buyer?: string; orderUrl?: string | null; notes?: string }): Sale` — copies `title`, `sku`, `costCents` (→ `itemCostCents`) from the listing; id from `nanoid12()` (`src/server/ids.ts`).
- `deleteSalesForListing(db, listingId)` — deletes all sale rows of that listing.
- `listSales(db, q: { from?: string; to?: string; marketplaceId?: string; q?: string }): { items: Sale[]; totals: SalesTotals }` — newest first; `from`/`to` are ISO dates compared with `soldAt`; `q` matches title or SKU (case-insensitive `LIKE`).
- `updateSale(db, id, patch)` — patch any of the editable fields (all except id, listingId, title, sku, source, timestamps); 404 when missing.
- `salesCsv(db, q)` — header `Sold at,Title,SKU,Platform,Sale price,Shipping charged,Fees,Shipping cost,Other costs,Item cost,Net,Buyer,Order link,Notes,Source`, money as `12.34`, using `toCsvRow` from `exporter.ts`.
- `backfillSales(db)` — for every listing with `soldAt` and no sale row: `createSale` with `source: 'manual'`, `salePriceCents: soldPriceCents`, `marketplaceId: soldMarketplaceId ?? 'elsewhere'`. Call it in `src/server/index.ts` right after `runMigrations(db)`.

### 4.3 Hook into mark sold / unmark sold — `src/server/services/sales.ts`

- `markSoldSchema` gains optional fields: `shippingChargedCents`, `marketplaceFeesCents`, `shippingCostCents`, `otherCostsCents` (each `z.number().int().min(0).nullable().optional()`), `buyer: z.string().max(200).optional()`, `orderUrl: z.string().url().nullable().optional()`, `notes: z.string().max(2000).optional()`.
- `markSold(db, id, body, source: Sale['source'] = 'manual')`: default sale price is now: `body.soldPriceCents ?? <that marketplace's listedPriceCents> ?? <effective price as today> ?? row.priceCents`. After the `listings` update, call `createSale(...)` with all the fields and `source`.
- `unmarkSold`: also `deleteSalesForListing(db, id)`.

### 4.4 Routes — new file `src/server/routes/salesLedger.ts`

Registered in `app.ts` after `priceChangeRoutes`:

- `GET /api/sales` → `listSales` (query: `from`, `to`, `marketplaceId`, `q`, all optional strings).
- `PATCH /api/sales/:id` → `updateSale`; body schema `saleUpdateSchema` in `shared/schemas.ts` (all editable fields optional; money fields `int ≥ 0` nullable; `soldAt` ISO datetime; `marketplaceId` = `marketplaceIdSchema` or `'elsewhere'`).
- `GET /api/sales/export.csv` → `text/csv` with `content-disposition: attachment; filename="crosslister-sales.csv"`.

### 4.5 UI

**Nav** — `src/web/components/Layout.tsx` `NAV`: insert `{ to: '/sales', label: 'Sold' }` right after Inventory. **Router** — `App.tsx`: `{ path: '/sales', element: <SalesPage /> }`.

**New page `src/web/pages/SalesPage.tsx`:**

- Heading **Sold**; right side: **Export CSV** button (link to `/api/sales/export.csv` with the current filters as query).
- Filters row: period select — **This month** (default), **Last 30 days**, **This year**, **All time** (computes `from`/`to`); platform select (All + every marketplace name + Elsewhere); search box ("Search title or SKU").
- Totals bar: **Items sold** N · **Revenue** $ (sum of sale price + shipping charged) · **Fees** $ · **Net** $.
- Table columns: **Date** (local date), **Item** (40 px thumb + title linking to `/listings/:id` when `listingId`, SKU underneath in grey), **Platform**, **Sale price**, **Shipping paid by buyer**, **Fees**, **Shipping cost**, **Item cost**, **Net** (green when > 0, red when < 0, "—" when null), **Buyer**, **Source** (Manual / Detected / eBay), and an **Edit** button.
- Empty state: "No sales in this period."
- **Edit** opens new `src/web/components/SaleEditModal.tsx`: date-time, platform, and every money field via `PriceInput` (empty = null), buyer, order link, notes; **Save** → `PATCH /api/sales/:id`, invalidate `['sales']`.

**`MarkSoldModal.tsx`** — under the existing fields add a collapsed **More sale details** section (`<details>`) with: Shipping paid by buyer, Fees, Shipping label cost, Other costs (all `PriceInput`, empty = not sent), Buyer, Order link, Notes. Send them in the mark-sold request.

**`ListingDetailPage.tsx`** — when the listing is sold, show a **Sale** card (date, platform, sale price, fees, net, buyer, order link) using the listing's sale row (add `sale: Sale | null` to `ListingDetail`, filled in `getListing` from the newest sale row of that listing) with an **Edit** button opening `SaleEditModal`.

### 4.6 Tests — `tests/sales/salesLedger.test.ts`

1. Mark sold on a marketplace with `soldPriceCents` 4000, fees 520, shipping cost 800, item cost on the listing 1000 → `GET /api/sales` returns one item with `netCents` 1680 and `source: 'manual'`; totals match.
2. Mark sold without a price where the marketplace row has `listedPriceCents` 4500 → sale price 4500.
3. Unmark sold → the sale row is gone.
4. `backfillSales`: a listing with `soldAt` set directly in the DB and no sale row → one row after the call; calling it twice still gives one row.
5. Filters: two sales on different dates and platforms; `from`/`to`, `marketplaceId` and `q` each narrow the list.
6. `PATCH /api/sales/:id` updates fees and the recomputed `netCents`.
7. CSV export has the header line and one line per sale.
8. Deleting the listing keeps the sale row with `listingId: null`.

Done when: `npm run typecheck && npm test` pass; `/sales` shows the sold item after marking it sold in the UI.

---

## 5. M48 — Sale listener and automatic delisting

### 5.1 Settings

`Settings.statusChecks` gains three fields (types, schema, defaults):

| Field | Schema | Default |
|---|---|---|
| `browserPollingEnabled` | `z.boolean()` | `true` |
| `browserIntervalMinutes` | `z.number().int().min(30).max(1440)` | `60` |
| `autoDelistOnSale` | `z.boolean()` | `true` |

Update the settings test expectations accordingly.

**New Settings tab "Sales"** — `SettingsPage.tsx` `TABS`: insert `['sales', 'Sales']` after `['marketplaces', 'Marketplaces']`; render new `src/web/components/settings/SalesTab.tsx`:

- Toggle **Watch my marketplaces for sales** (`browserPollingEnabled`). Help: "While Crosslister is running, it looks at your live Mercari, Poshmark, Depop and Grailed listings in a background tab to see whether they sold. eBay is checked through its API (see the eBay tab)."
- Number **Check every N minutes** (`browserIntervalMinutes`, 30–1440), disabled when the toggle is off.
- Toggle **When an item sells, remove it from the other marketplaces automatically** (`autoDelistOnSale`). Help: "The sale is recorded on the Sold page. For marketplaces where you click the final button yourself, you'll get a card in Activity to confirm each removal. Turn on “Click the final Publish button for me” for a marketplace (Settings → Marketplaces) to let the app remove it without asking."
- Read-only line: **Last check:** `timeAgo(kv browser_last_poll)` or "never" — fetch `GET /api/settings/kv/browser_last_poll`.
- Button **Check now** → `POST /api/status-checks/run` (exists) with body `{}`.

### 5.2 Background tab for status checks — `src/server/browser/browserManager.ts`

Add to `browserManager`:

```ts
  /** A tab for background work (status checks) that is not the marketplace's main tab. Attach mode: a new tab, closed with closeTempPage. Launch mode: the marketplace's page. */
  async openTempPage(mp: MarketplaceId): Promise<Page> {
    if (browserMode() !== 'attach') return this.getPage(mp);
    const page = await (await sharedContext()).newPage();
    return page;
  },
  async closeTempPage(page: Page): Promise<void> {
    if (browserMode() !== 'attach') return;
    try { await page.close(); } catch { /* already closed */ }
  },
```

`src/server/marketplaces/common.ts` `browserCheckStatus` — replace `const page = await ctx.page();` with:

```ts
  const page = await browserManager.openTempPage(adapter.id);
  ctx.trace?.attach(page);
  try {
```

and wrap the rest of the function body in that `try`, with `finally { await browserManager.closeTempPage(page); }`. (Import `browserManager` from `'../browser/browserManager'`.) This way a timed check never navigates away from a tab the user may be using.

### 5.3 Confirm, then record the sale and delist — `src/server/services/statusChecks.ts`

1. New exported function:

```ts
/** A marketplace says the item sold. Records the sale and (setting) removes it everywhere else; otherwise shows the banner as before. */
export function handleDetectedSale(db: Db, ml: MarketplaceListing, details: { salePriceCents?: number | null; source: 'detected' | 'ebay_api' }): void {
  const l = db.select().from(listings).where(eq(listings.id, ml.listingId)).get();
  if (!l || l.soldAt) return;
  const s = getSettings(db).statusChecks;
  if (!s.autoDelistOnSale) { applyRemoteStatus(db, ml, 'sold'); return; }
  const others = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, l.id), eq(marketplaceListings.status, 'active'))).all()
    .map((r) => r.marketplaceId as MarketplaceId).filter((m) => m !== ml.marketplaceId);
  const { jobs: created } = markSold(db, l.id, {
    marketplaceId: ml.marketplaceId, soldPriceCents: details.salePriceCents ?? null, deactivateMarketplaceIds: others,
  }, details.source);
  events.publish({ type: 'sale.detected', listingId: l.id, marketplaceId: ml.marketplaceId });
  events.publish({ type: 'listing.updated', listingId: l.id });
  const where = others.map((m) => MARKETPLACE_NAMES[m]).join(', ');
  notifyUser(`Sold on ${MARKETPLACE_NAMES[ml.marketplaceId]}`, others.length ? `${l.title} — removing it from ${where}.` : l.title);
  logger.info('STATUS', `Sale detected on ${MARKETPLACE_NAMES[ml.marketplaceId]}; ${created.length} removal job(s) created`, { listingId: l.id, marketplaceId: ml.marketplaceId });
}
```

(Import `markSold` from `'./sales'`. If that creates an import cycle that breaks `tests/server/startup.test.ts`, move `handleDetectedSale` into a new file `src/server/services/saleListener.ts` and import it from `statusChecks.ts` lazily with `await import('./saleListener')` inside the async handler.)

2. In the `status_check` job handler, replace

```ts
  const status = await ctx.step('check', `Checking ${MARKETPLACE_NAMES[adapter.id]}`, () => adapter.checkStatus!(ctx, ml));
  applyRemoteStatus(ctx.db, ml, status);
  return { status };
```

with

```ts
  let status = await ctx.step('check', `Checking ${MARKETPLACE_NAMES[adapter.id]}`, () => adapter.checkStatus!(ctx, ml));
  if (status === 'sold' && adapter.kind === 'browser') {
    // Never remove an item everywhere on one page load: look again after a minute.
    const wait = Number(process.env.CROSSLISTER_SALE_CONFIRM_MS ?? 60_000);
    await ctx.sleep(wait);
    status = await ctx.step('confirm', 'Confirming the sale', () => adapter.checkStatus!(ctx, ml));
  }
  if (status === 'sold') handleDetectedSale(ctx.db, ml, { source: 'detected' });
  else applyRemoteStatus(ctx.db, ml, status);
  return { status };
```

`tests/helpers/setupEnv.ts`: append `process.env.CROSSLISTER_SALE_CONFIRM_MS = '0';`.

3. eBay polling (`pollEbay`): replace `applyRemoteStatus(db, rowToMarketplaceListing(row), 'sold'); sold++;` with `handleDetectedSale(db, rowToMarketplaceListing(row), { source: 'ebay_api' }); sold++;`. In the eBay adapter's own `checkStatus` path nothing changes (it goes through the job handler above; eBay is `api`, so no confirm wait).

4. `applyRemoteStatus`'s `'sold'` branch stays as is (it is the "banner" behaviour when auto-delist is off).

### 5.4 Timed browser checks

Add to `src/server/services/statusChecks.ts`:

```ts
const BROWSER_LAST_POLL_KEY = 'browser_last_poll';
const MAX_CHECKS_PER_MARKETPLACE = 20;

/** Timed sale watch for browser marketplaces (14 §5). Oldest-checked listings first, at most 20 per marketplace per round. */
export function pollBrowserMarketplaces(db: Db, now = Date.now()): { ran: boolean; jobs: number } {
  const s = getSettings(db).statusChecks;
  if (!s.browserPollingEnabled) return { ran: false, jobs: 0 };
  const last = getKv<number>(db, BROWSER_LAST_POLL_KEY, 0);
  if (now - last < s.browserIntervalMinutes * 60_000) return { ran: false, jobs: 0 };
  const pending = db.select().from(jobs).where(and(eq(jobs.type, 'status_check'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']))).all();
  if (pending.length > 0) return { ran: false, jobs: 0 };
  setKv(db, BROWSER_LAST_POLL_KEY, now);
  const rows = db.select().from(marketplaceListings).where(eq(marketplaceListings.status, 'active')).all()
    .filter((r) => { try { const a = getAdapter(r.marketplaceId as MarketplaceId); return a.kind === 'browser' && a.capabilities.statusCheck === 'browser' && !!a.checkStatus && !!r.url; } catch { return false; } })
    .sort((a, b) => (a.lastSyncedAt ?? '').localeCompare(b.lastSyncedAt ?? ''));
  const perMp = new Map<string, number>();
  const picked = rows.filter((r) => { const n = perMp.get(r.marketplaceId) ?? 0; if (n >= MAX_CHECKS_PER_MARKETPLACE) return false; perMp.set(r.marketplaceId, n + 1); return true; });
  const created: Job[] = [];
  const seen = new Map<string, number>();
  for (const r of picked) {
    const n = seen.get(r.marketplaceId) ?? 0;
    seen.set(r.marketplaceId, n + 1);
    created.push(createJob(db, { type: 'status_check', marketplaceId: r.marketplaceId as MarketplaceId, listingId: r.listingId, input: { pause: n > 0, timed: true } }));
  }
  if (created.length) logger.info('STATUS', `Timed sale check: ${created.length} listing(s)`);
  return { ran: true, jobs: created.length };
}

registerTick((db) => { pollBrowserMarketplaces(db); });
```

Timed checks must not pester the user: in `browserCheckStatus` nothing asks the user (a login wall already returns `unknown`), so no change is needed there. In the job runner, a **failed** `status_check` job with `input.timed === true` must not call `notifyUser` — in `executeJob`'s failure branch wrap the `notifyUser(...)` call in `if (!(job.type === 'status_check' && (input as { timed?: boolean }).timed))`. (Widen the `input` type annotation at the top of `executeJob` to `{ previousStatus?: string; timed?: boolean }`.)

Also hide timed status-check jobs from the Activity drawer's default list unless they failed or found a sale: in `listJobs` (`src/server/services/jobs.ts`), when `active` is not requested, exclude rows where `type = 'status_check'` and `input.timed` is true and `state = 'SUCCESS'` and `result.status !== 'sold'` (filter in JS after the query; keep the `limit` by over-fetching `limit * 3` rows and slicing).

### 5.5 Tests — add to `tests/sales/statusChecks.test.ts` (or a new `tests/sales/saleListener.test.ts`)

Use fake browser adapters whose `checkStatus` returns scripted values (as the existing status-check tests do).

1. Auto-delist on: a listing active on fake `mercari` (checkStatus → `'sold'`) and fake `poshmark` (active). Run a status check for mercari → listing `soldAt` set, one `sales` row with `source: 'detected'` and `marketplaceId: 'mercari'`, and one `deactivate` job for poshmark.
2. Confirmation: mercari's `checkStatus` returns `'sold'` then `'active'` → nothing is marked sold; the marketplace row stays `active`.
3. Auto-delist off: the old behaviour — `saleDetectedMarketplaceId` set, no sale row, no deactivate jobs.
4. `pollBrowserMarketplaces`: with 25 active rows on one fake browser marketplace → 20 `status_check` jobs with `input.timed: true`; calling it again immediately → 0 (interval); with the setting off → 0.
5. eBay poll path: adapt the existing `tests/marketplace/ebay/polling.test.ts` sold case — it now produces a sale row with `source: 'ebay_api'` and deactivate jobs for the other active marketplaces (auto-delist default on). Update its expectations; keep a second case with auto-delist off expecting the old banner behaviour.
6. A failed timed status check does not call `notifyUser` (spy on `notifyUser` via `vi.mock('../../src/server/services/notify')`, same way other tests mock modules if any do; otherwise assert through the log: no `failed` notification line).

Done when: `npm run typecheck && npm test && npm run test:browser` pass.

---

## 6. M49 — Round 3 docs

Text only.

1. New **`docs/TRACES.md`** — what a trace folder contains (`meta.json`, `trace.jsonl` event kinds from §1.3/§1.5, `snapshots/` with `.png`/`.html`/`.aria.yml`/`.controls.json`, `user-filled-*.controls.json`, `report.md`), how to get one (`npm run trace:report -- latest poshmark`, **Download trace** in Activity), and **"How to fix a field from a trace"**: (1) open `report.md`, find the step that did not finish `done`; (2) read the `locator` lines — every candidate with its match counts; (3) open the step's `.controls.json` (or `user-filled-*.controls.json` to see what you picked by hand) and find the real control: its `labels`, `ariaLabel`, `placeholder`, `testId`, `near`, `css`; (4) add a candidate built from those at the **top** of the spec in `src/server/marketplaces/<mp>/selectors.ts`; (5) for option lists, compare `wanted` with `seen` in the `options` lines and add synonyms in `<mp>/mapping.ts`; (6) mirror the real markup in `fixtures/marketplace-pages/<mp>/sell.html` and run `npm run test:browser`. State that traces stay on this Mac in `data/traces/` and skip HTML/control snapshots on login pages.
2. **`README.md`** — add short sections: **Change a price** (Listing → Change price; updates every marketplace that supports it; manual marketplaces show an Open link), **Sold page** (what it shows, Export CSV), **Automatic sale detection** (what is checked, how often, auto-removal, the Sales settings tab). Link `docs/TRACES.md` from the troubleshooting area.
3. **`docs/TROUBLESHOOTING.md`** — add: "**A field wasn't filled.** → Open Activity → the job → **Download trace**, or run `npm run trace:report -- latest <marketplace>`, and follow `docs/TRACES.md`."
4. **`docs/spec/08-sales-delisting.md`** — add at the top: "> Round 3 (`14-round-3-traces-price-sales.md` §4–§5) adds the `sales` table, timed browser checks and automatic delisting. Where they disagree, file 14 wins."
5. **`IMPLEMENTATION_SUMMARY.md`** — milestone row `| M44–M49 (round 3: traces, price changes, sales, sale listener) | Done |`; decisions bullets for anything you had to adapt; "Known bugs / gaps": "Timed sale checks rely on each marketplace's item page (JSON-LD / sold badge); uncalibrated." and "Mercari category/brand/condition/weight still need calibration — use a trace."
6. **`CLAUDE.md`** — "Current milestone" → `M1–M49 done — see IMPLEMENTATION_SUMMARY.md (browser adapters are assisted, uncalibrated).`

Done when: `npm run typecheck && npm test` pass; commit `M49: Round 3 docs`.

---

## 7. After M49 — for the user

1. List one item on Poshmark and Mercari again. Poshmark should get past the covershot dialog. Then run `npm run trace:report -- latest mercari` and `npm run trace:report -- latest poshmark` and give the output (or the trace ZIPs) to Claude to calibrate the remaining fields.
2. Try **Change price** on a live item and check each marketplace shows the new price.
3. Leave the app running with Settings → Sales on; when something sells, check the Sold page and the removal cards in Activity.
