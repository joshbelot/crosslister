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
