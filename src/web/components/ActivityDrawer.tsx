import { X } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo } from 'react';
import type { Job } from '../../shared/types';
import { useJobs } from '../api/hooks';
import { JobCard } from './JobCard';

export function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const jobs = useJobs({ active: true });
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; listingId: string | null; title: string; newest: string; jobs: Job[] }>();
    for (const j of jobs.data ?? []) {
      const key = j.listingId ?? `none-${j.type}`;
      const g = map.get(key) ?? { key, listingId: j.listingId, title: j.listingTitle ?? (j.type === 'connect' ? 'Marketplace connections' : 'Other'), newest: j.createdAt, jobs: [] };
      g.jobs.push(j);
      if (j.createdAt > g.newest) g.newest = j.createdAt;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.newest.localeCompare(a.newest));
  }, [jobs.data]);

  return (
    <aside className="fixed right-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-[420px] flex-col border-l border-zinc-200 bg-zinc-50 shadow-xl" aria-label="Activity">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <h2 className="font-semibold">Activity</h2>
        <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Close activity"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {groups.length === 0 && <p className="text-sm text-zinc-500">Nothing is running.</p>}
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-2 truncate text-sm font-semibold text-zinc-700">
              {g.listingId ? <Link to={`/listings/${g.listingId}`} className="hover:underline" onClick={onClose}>{g.title || 'Untitled listing'}</Link> : g.title}
            </h3>
            <div className="space-y-2">{g.jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>
          </section>
        ))}
      </div>
    </aside>
  );
}
