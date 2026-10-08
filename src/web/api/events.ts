import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AppEvent, Job, LogEntry } from '../../shared/types';
import { MARKETPLACE_NAMES } from '../../shared/constants';
import { setUi } from '../lib/ui';

const liveLogs: LogEntry[] = [];
const logListeners = new Set<() => void>();
export function subscribeLiveLogs(fn: () => void): () => void {
  logListeners.add(fn);
  return () => { logListeners.delete(fn); };
}
export const getLiveLogs = () => liveLogs;

export function useEventStream(): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      let e: AppEvent;
      try { e = JSON.parse(msg.data) as AppEvent; } catch { return; }
      switch (e.type) {
        case 'job.updated': {
          const job = e.job;
          qc.setQueriesData<Job[]>({ queryKey: ['jobs'] }, (old) => {
            if (!old) return old;
            const i = old.findIndex((j) => j.id === job.id);
            if (i === -1) return old;
            const copy = old.slice();
            copy[i] = { ...old[i], ...job };
            return copy;
          });
          void qc.invalidateQueries({ queryKey: ['jobs'] });
          if (job.listingId) void qc.invalidateQueries({ queryKey: ['listing', job.listingId] });
          void qc.invalidateQueries({ queryKey: ['listings'] });
          if (job.state === 'NEEDS_USER' && job.needsUser) {
            setUi({ drawerOpen: true });
            toast.warning(job.needsUser.title);
          } else if (job.state === 'FAILED') {
            const name = job.marketplaceId ? MARKETPLACE_NAMES[job.marketplaceId] : 'Job';
            toast.error(`${name} failed`);
          }
          break;
        }
        case 'listing.updated':
        case 'listing.deleted':
          void qc.invalidateQueries({ queryKey: ['listing', e.listingId] });
          void qc.invalidateQueries({ queryKey: ['listings'] });
          void qc.invalidateQueries({ queryKey: ['validation', e.listingId] });
          break;
        case 'connection.updated':
          void qc.invalidateQueries({ queryKey: ['marketplaces'] });
          break;
        case 'import.updated':
          void qc.invalidateQueries({ queryKey: ['import', e.batchId] });
          break;
        case 'sale.detected':
          void qc.invalidateQueries({ queryKey: ['listings'] });
          void qc.invalidateQueries({ queryKey: ['listing', e.listingId] });
          toast('Sale detected', { description: `Sold on ${MARKETPLACE_NAMES[e.marketplaceId]}.` });
          break;
        case 'log':
          liveLogs.unshift(e.entry);
          if (liveLogs.length > 300) liveLogs.length = 300;
          logListeners.forEach((l) => l());
          break;
      }
    };
    return () => es.close();
  }, [qc]);

  return { connected };
}
