import { useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '../../shared/types';
import { useJobCancel, useJobContinue, useOpenPhotos } from '../api/hooks';

export function NeedsUserCard({ job }: { job: Job }) {
  const req = job.needsUser!;
  const cont = useJobContinue();
  const cancel = useJobCancel();
  const openPhotos = useOpenPhotos();
  const [url, setUrl] = useState('');

  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(`Copied ${label}`); } catch { toast.error('Could not copy to the clipboard.'); }
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="needs-user-card">
      <div className="flex items-start gap-2 font-semibold text-amber-900"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {req.title}</div>
      <p className="mt-1 text-amber-900">{req.instructions}</p>
      {req.missingFields && req.missingFields.length > 0 && (
        <div className="mt-2">
          <p className="font-medium text-amber-900">Fill these in the browser:</p>
          <ul className="ml-5 list-disc text-amber-900">{req.missingFields.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {req.copyFields && req.copyFields.length > 0 && (
        <ul className="mt-3 divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
          {req.copyFields.map((f) => (
            <li key={f.label} className="flex items-start gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-zinc-500">{f.label}</div>
                <div className="line-clamp-2 whitespace-pre-wrap break-words text-zinc-800">{f.value}</div>
              </div>
              <button className="btn btn-secondary btn-sm shrink-0" onClick={() => void copy(f.label, f.value)} aria-label={`Copy ${f.label}`}><Copy size={12} /> Copy</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {req.link && (
          <a className="btn btn-secondary btn-sm" href={req.link.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {req.link.label}</a>
        )}
        {req.photoFolder && job.listingId && job.marketplaceId && (
          <button className="btn btn-secondary btn-sm" disabled={openPhotos.isPending}
            onClick={() => openPhotos.mutate({ id: job.listingId!, mp: job.marketplaceId! }, { onSuccess: (r) => toast.info(`Photos are in ${r.path}`) })}>
            <FolderOpen size={13} /> Open photos folder
          </button>
        )}
      </div>
      {req.allowUrlInput && (
        <div className="mt-3">
          <label className="label" htmlFor={`url-${job.id}`}>Listing URL (optional)</label>
          <input id={`url-${job.id}`} className="input h-9" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={cont.isPending} onClick={() => cont.mutate({ id: job.id, url: url.trim() || null })}>{req.primaryAction}</button>
        <button className="btn btn-secondary btn-sm" disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancel this job?')) cancel.mutate(job.id); }}>Cancel</button>
      </div>
    </div>
  );
}
