import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTraceReport } from '../../src/server/browser/traceReport';

describe('trace report', () => {
  it('lists steps that need the user, missed locators and option lists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-report-'));
    fs.mkdirSync(path.join(dir, 'snapshots'));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      jobId: 'j1', type: 'publish', marketplaceId: 'mercari', listingId: 'l1', startedAt: '2026-10-15T10:00:00Z', appVersion: '0.1.0', state: 'SUCCESS', missingFields: ['Selecting brand'],
    }));
    const events = [
      { t: 'x', ms: 10, kind: 'step.start', seq: 1, key: 'brand', label: 'Selecting brand' },
      { t: 'x', ms: 20, kind: 'locator', what: 'Brand', ok: false, chosen: null, waitedMs: 6000, candidates: [{ desc: 'label=/^brand/i', count: 0, visible: 0 }] },
      { t: 'x', ms: 30, kind: 'options', what: 'Brand', wanted: ["Levi's"], seen: ['Nike', 'Adidas'], match: null },
      { t: 'x', ms: 40, kind: 'step.end', seq: 1, key: 'brand', state: 'needs_user', message: 'Please fill Brand' },
    ];
    fs.writeFileSync(path.join(dir, 'trace.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const md = buildTraceReport(dir);
    expect(md).toContain('Selecting brand');
    expect(md).toContain('NOT FOUND');
    expect(md).toContain('"Nike"');
  });
});
