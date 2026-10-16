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
  missingFields?: string[]; input?: unknown; appVersion: string; listing?: Record<string, unknown>;
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
