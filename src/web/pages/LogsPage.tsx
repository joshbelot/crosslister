import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FolderOpen } from 'lucide-react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { MARKETPLACE_IDS, MARKETPLACE_NAMES } from '../../shared/constants';
import type { LogEntry } from '../../shared/types';
import { api } from '../api/client';
import { getLiveLogs, subscribeLiveLogs } from '../api/events';
import { useHealth, useLogs, type LogFilters } from '../api/hooks';

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const LEVEL_STYLE: Record<LogEntry['level'], string> = { debug: 'text-zinc-400', info: 'text-zinc-600', warn: 'text-amber-600', error: 'text-red-600 font-medium' };

export function LogsPage() {
  const [filters, setFilters] = useState<LogFilters>({ level: 'info', marketplaceId: '', q: '' });
  const [text, setText] = useState('');
  useEffect(() => { const t = setTimeout(() => setFilters((f) => ({ ...f, q: text })), 250); return () => clearTimeout(t); }, [text]);
  const logs = useLogs(filters);
  const health = useHealth().data;
  const live = useSyncExternalStore(subscribeLiveLogs, getLiveLogs);

  const rows = useMemo(() => {
    const stored = logs.data?.pages.flat() ?? [];
    const newestStored = stored[0]?.id ?? 0;
    const q = filters.q.toLowerCase();
    const matching = live.filter((e) =>
      e.id > newestStored && LEVEL_RANK[e.level] >= LEVEL_RANK[filters.level]
      && (!filters.marketplaceId || e.marketplaceId === filters.marketplaceId)
      && (!q || e.message.toLowerCase().includes(q) || e.scope.toLowerCase().includes(q)));
    return [...matching, ...stored].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
  }, [logs.data, live, filters]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Logs</h1>
        <div className="ml-auto flex items-center gap-2">
          <select className="input w-40" aria-label="Level" value={filters.level} onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as LogFilters['level'] }))}>
            <option value="info">Info and above</option><option value="warn">Warnings and above</option><option value="error">Errors only</option>
          </select>
          <select className="input w-44" aria-label="Marketplace" value={filters.marketplaceId} onChange={(e) => setFilters((f) => ({ ...f, marketplaceId: e.target.value }))}>
            <option value="">All marketplaces</option>
            {MARKETPLACE_IDS.map((id) => <option key={id} value={id}>{MARKETPLACE_NAMES[id]}</option>)}
          </select>
          <input className="input w-56" placeholder="Search logs…" aria-label="Search logs" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-secondary" onClick={() => void api.post('/api/system/open-folder', { which: 'logs' })} title={health?.logsDir}><FolderOpen size={15} /> Open log folder</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500"><tr><th className="w-44 px-3 py-2">Time</th><th className="w-16">Level</th><th className="w-28">Scope</th><th>Message</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100 align-top" data-testid="log-row">
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-zinc-500">{fmt(e.ts)}</td>
                <td className={clsx('py-1.5 text-xs uppercase', LEVEL_STYLE[e.level])}>{e.level}</td>
                <td className="py-1.5 font-mono text-xs">{e.scope}</td>
                <td className="py-1.5 pr-3 break-words">
                  {e.message}
                  {e.listingId && <Link className="ml-2 text-xs text-indigo-600 hover:underline" to={`/listings/${e.listingId}`}>listing</Link>}
                  {e.jobId && <span className="ml-2 font-mono text-xs text-zinc-400">job {e.jobId}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-zinc-500">{logs.isLoading ? 'Loading…' : 'No log entries match.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {logs.hasNextPage && <div className="mt-4 text-center"><button className="btn btn-secondary" disabled={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>Load more</button></div>}
    </div>
  );
}
