import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, Minus, X } from 'lucide-react';
import clsx from 'clsx';
import { MARKETPLACE_NAMES, type JobType } from '../../shared/constants';
import type { Job, JobStep } from '../../shared/types';
import { useJobRetry, useMarkListed, useMarketplaces } from '../api/hooks';
import { NeedsUserCard } from './NeedsUserCard';

const ACTION: Record<JobType, string> = {
  publish: 'Publishing', update: 'Updating', deactivate: 'Removing', connect: 'Connecting', status_check: 'Checking status',
  import_scan: 'Importing', import_fetch: 'Importing',
};
const STATE_PILL: Record<Job['state'], string> = {
  NOT_STARTED: 'bg-zinc-100 text-zinc-600', IN_PROGRESS: 'bg-blue-100 text-blue-700', NEEDS_USER: 'bg-amber-100 text-amber-800',
  SUCCESS: 'bg-green-100 text-green-700', FAILED: 'bg-red-100 text-red-700', CANCELLED: 'bg-zinc-100 text-zinc-500',
};
const STATE_LABEL: Record<Job['state'], string> = {
  NOT_STARTED: 'Queued', IN_PROGRESS: 'Running', NEEDS_USER: 'Needs you', SUCCESS: 'Done', FAILED: 'Failed', CANCELLED: 'Cancelled',
};

function StepIcon({ state }: { state: JobStep['state'] }) {
  switch (state) {
    case 'done': return <Check size={14} className="text-green-600" />;
    case 'running': return <Loader2 size={14} className="animate-spin text-blue-600" />;
    case 'needs_user': return <AlertTriangle size={14} className="text-amber-500" />;
    case 'failed': return <X size={14} className="text-red-600" />;
    default: return <Minus size={14} className="text-zinc-400" />;
  }
}

export function JobCard({ job }: { job: Job }) {
  const name = job.marketplaceId ? MARKETPLACE_NAMES[job.marketplaceId] : 'App';
  const retry = useJobRetry();
  const markListed = useMarkListed();
  const infos = useMarketplaces().data ?? [];
  const info = infos.find((m) => m.id === job.marketplaceId);
  const [markOpen, setMarkOpen] = useState(false);
  const [markUrl, setMarkUrl] = useState('');
  const result = job.result as { url?: string | null; verified?: boolean } | null;

  return (
    <div className="card p-3" data-testid="job-card" data-state={job.state}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{name} <span className="font-normal text-zinc-500">· {ACTION[job.type]}</span></div>
        <span className={clsx('pill', STATE_PILL[job.state])}>{STATE_LABEL[job.state]}</span>
      </div>
      {job.steps && job.steps.length > 0 && (
        <ul className="mt-2 space-y-1">
          {job.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5"><StepIcon state={s.state} /></span>
              <div className="min-w-0 flex-1">
                <span className="text-zinc-800">{s.label}</span>
                {s.message && <div className="text-xs text-zinc-500">{s.message}</div>}
              </div>
              {s.screenshotUrl && <a href={s.screenshotUrl} target="_blank" rel="noreferrer" title="Screenshot"><img src={s.screenshotUrl} alt="" className="h-8 w-12 rounded border border-zinc-200 object-cover" /></a>}
            </li>
          ))}
        </ul>
      )}

      {job.state === 'NEEDS_USER' && job.needsUser && <NeedsUserCard job={job} />}

      {job.state === 'FAILED' && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="job-failed">
          <div className="font-semibold">❌ {name} failed</div>
          <p className="mt-1">Reason: {job.errorMessage}</p>
          {job.type === 'publish' && <p className="mt-1">Your listing has NOT been marked as successfully listed.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-secondary btn-sm" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>Retry</button>
            {info && <a className="btn btn-secondary btn-sm" href={info.urls.sell} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open {name}</a>}
            {job.type === 'publish' && job.listingId && job.marketplaceId && (
              <button className="btn btn-secondary btn-sm" onClick={() => setMarkOpen((o) => !o)}>Mark as listed…</button>
            )}
          </div>
          {markOpen && job.listingId && job.marketplaceId && (
            <div className="mt-2 flex gap-2">
              <input className="input h-9" placeholder="Listing URL (optional)" value={markUrl} onChange={(e) => setMarkUrl(e.target.value)} aria-label="Listing URL" />
              <button className="btn btn-primary btn-sm" disabled={markListed.isPending}
                onClick={() => markListed.mutate({ id: job.listingId!, mp: job.marketplaceId!, url: markUrl.trim() || null }, { onSuccess: () => setMarkOpen(false) })}>Mark listed</button>
            </div>
          )}
        </div>
      )}

      {job.state === 'SUCCESS' && job.type === 'publish' && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          ✓ Listed on {name}
          {result?.url ? <a className="font-medium underline" href={result.url} target="_blank" rel="noreferrer">View listing</a> : <span className="text-green-700">(unverified)</span>}
        </div>
      )}
      {job.state === 'SUCCESS' && job.type === 'deactivate' && <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">✓ Removed from {name}</div>}
      {job.state === 'SUCCESS' && job.type === 'update' && <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">✓ Updated on {name}</div>}
      {job.state === 'SUCCESS' && job.type === 'connect' && <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">✓ Connected to {name}</div>}
      {job.state === 'CANCELLED' && <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500">Cancelled</div>}
    </div>
  );
}
