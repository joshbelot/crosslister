import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ValidationIssue } from '../../shared/types';
import { api, ApiError } from '../api/client';
import { useCrosslist, useListing, useMarketplaces, useValidation } from '../api/hooks';
import { setUi } from '../lib/ui';
import { Modal } from './Modal';
import { OverridesPanel } from './OverridesPanel';

const KIND_TAG = { api: 'API', browser: 'Assisted', manual: 'Manual' } as const;

export function CrosslistFlow({ listingId, selected, open, onClose, focusField, overridesFor, setOverridesFor }: {
  listingId: string | null; selected: MarketplaceId[]; open: boolean; onClose: () => void;
  focusField: (name: string) => void; overridesFor: string | null; setOverridesFor: (mp: string | null) => void;
}) {
  const qc = useQueryClient();
  const listing = useListing(listingId ?? undefined).data;
  const marketplaces = useMarketplaces().data ?? [];
  const validation = useValidation(listingId ?? undefined, selected, open);
  const crosslist = useCrosslist();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [poshmarkNotice, setPoshmarkNotice] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const ack = useQuery({ queryKey: ['kv', 'poshmark_notice_ack'], queryFn: () => api.get<{ value: unknown }>('/api/settings/kv/poshmark_notice_ack'), enabled: open });

  useEffect(() => { if (open && listingId) void qc.invalidateQueries({ queryKey: ['validation', listingId] }); }, [open, listingId, qc]);

  const report = validation.data;
  const canonicalErrors = report?.canonical.filter((i) => i.severity === 'error') ?? [];
  const rows = report?.marketplaces ?? [];
  const readyIds = rows.filter((m) => m.ready).map((m) => m.marketplaceId);

  const fix = (mp: MarketplaceId | null, issue: ValidationIssue) => {
    if (issue.field.startsWith('data') || issue.field === 'category') {
      if (mp) { onClose(); setOverridesFor(mp); return; }
    }
    onClose();
    setTimeout(() => focusField(issue.field), 100);
  };

  const run = () => {
    if (!listingId) return;
    crosslist.mutate({ id: listingId, marketplaceIds: readyIds }, {
      onSuccess: (res) => {
        onClose();
        setUi({ drawerOpen: true });
        for (const s of res.skipped) toast.info(`${MARKETPLACE_NAMES[s.marketplaceId]}: ${s.reason}`);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'NOT_READY') { toast.error('Some marketplaces need more information.'); void validation.refetch(); }
        else toast.error(err instanceof Error ? err.message : 'Cross-listing failed.');
      },
    });
  };
  const confirm = () => {
    if (readyIds.includes('poshmark') && !ack.data?.value) { setPoshmarkNotice(true); return; }
    run();
  };

  const statusOf = (m: (typeof rows)[number]) => (!m.ready ? 'error' : m.issues.length > 0 ? 'warn' : 'ready');
  const infoOf = (id: MarketplaceId) => marketplaces.find((x) => x.id === id);

  const modalFooter = useMemo(() => (
    <>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={readyIds.length === 0 || crosslist.isPending || canonicalErrors.length > 0} onClick={confirm} autoFocus>
        Cross-list to {readyIds.length} marketplace{readyIds.length === 1 ? '' : 's'}
      </button>
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [readyIds.join(','), crosslist.isPending, canonicalErrors.length, ack.data]);

  useEffect(() => {
    if (!open || poshmarkNotice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button,a,input,textarea,select') && readyIds.length > 0 && canonicalErrors.length === 0) { e.preventDefault(); confirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poshmarkNotice, readyIds.join(','), canonicalErrors.length, ack.data]);

  return (
    <>
      {open && (
        <Modal title="Cross-listing validation" onClose={onClose} wide footer={modalFooter}>
          {!report && <p className="text-sm text-zinc-500">Checking…</p>}
          {canonicalErrors.length > 0 && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3" data-testid="canonical-errors">
              <p className="mb-2 text-sm font-semibold text-red-800">Fix these before cross-listing:</p>
              <ul className="space-y-1">
                {canonicalErrors.map((i) => (
                  <li key={i.message} className="flex items-center justify-between gap-3 text-sm text-red-900">
                    <span>{i.message}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => fix(null, i)}>Fix</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {rows.map((m) => {
              const info = infoOf(m.marketplaceId);
              const st = statusOf(m);
              const isOpen = expanded.has(m.marketplaceId) || st === 'error';
              const own = m.issues.filter((i) => !canonicalErrors.some((c) => c.message === i.message));
              return (
                <li key={m.marketplaceId} data-testid={`validation-${m.marketplaceId}`}>
                  <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.marketplaceId)) n.delete(m.marketplaceId); else n.add(m.marketplaceId); return n; })}>
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-medium">{MARKETPLACE_NAMES[m.marketplaceId]}</span>
                    {info && <span className="rounded bg-zinc-100 px-1 text-[10px] uppercase tracking-wide text-zinc-500">{KIND_TAG[info.kind]}</span>}
                    <span className={clsx('ml-auto inline-flex items-center gap-1 text-sm', st === 'ready' && 'text-green-600', st === 'warn' && 'text-amber-600', st === 'error' && 'text-red-600')}>
                      {st === 'ready' && <><Check size={14} /> Ready</>}
                      {st === 'warn' && <><AlertTriangle size={14} /> Ready with warnings</>}
                      {st === 'error' && <><X size={14} /> Missing information</>}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-1 bg-zinc-50 px-11 py-2 text-sm">
                      {info && info.kind === 'browser' && info.connection.status !== 'connected' && <p className="text-zinc-600">Not connected — you'll be asked to log in.</p>}
                      {own.length === 0 && <p className="text-zinc-500">No issues.</p>}
                      {own.map((i, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3">
                          <span className={i.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>{i.severity === 'error' ? '✗' : '⚠'} {i.message}</span>
                          <button className="btn btn-secondary btn-sm shrink-0" onClick={() => fix(m.marketplaceId, i)}>Fix</button>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
      {poshmarkNotice && (
        <Modal title="Before you list on Poshmark" onClose={() => setPoshmarkNotice(false)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setPoshmarkNotice(false)}>Cancel</button>
            <button className="btn btn-primary" autoFocus onClick={() => {
              if (dontShow) void api.put('/api/settings/kv/poshmark_notice_ack', { value: true }).then(() => qc.invalidateQueries({ queryKey: ['kv', 'poshmark_notice_ack'] }));
              setPoshmarkNotice(false); run();
            }}>Continue</button>
          </>}>
          <p className="text-sm">Poshmark's terms restrict automated tools. The app will fill the form and you'll click List yourself. Continue?</p>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} /> Don't show again</label>
        </Modal>
      )}
      {overridesFor && listingId && selected.length > 0 && (
        <OverridesPanel listingId={listingId} listingTitle={listing?.title ?? ''} marketplaceIds={selected}
          active={(selected.includes(overridesFor as MarketplaceId) ? overridesFor : selected[0]) as MarketplaceId}
          onTab={(mp) => setOverridesFor(mp)} onClose={() => setOverridesFor(null)} />
      )}
    </>
  );
}
