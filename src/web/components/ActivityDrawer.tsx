import { X } from 'lucide-react';
import { useJobs } from '../api/hooks';

/** Skeleton for M10; job cards and the needs-user card arrive in M13. */
export function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const jobs = useJobs({ active: true });
  return (
    <aside className="fixed right-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-[420px] flex-col border-l border-zinc-200 bg-white shadow-xl" aria-label="Activity">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">Activity</h2>
        <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Close activity"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-sm text-zinc-500">
        {(jobs.data ?? []).length === 0 ? 'Nothing is running.' : `${jobs.data?.length} job(s)`}
      </div>
    </aside>
  );
}
