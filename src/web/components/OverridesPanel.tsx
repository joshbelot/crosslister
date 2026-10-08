import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import type { MarketplaceId } from '../../shared/constants';
import { useListing, useMarketplaces, usePatchTarget, usePreview } from '../api/hooks';
import { formatCents } from '../lib/format';
import { DataFieldInput } from './DataFieldInput';
import { PriceInput } from './fields/PriceInput';

function Tab({ mp, listingId, listingTitle }: { mp: MarketplaceId; listingId: string; listingTitle: string }) {
  const listing = useListing(listingId).data;
  const info = (useMarketplaces().data ?? []).find((m) => m.id === mp);
  const preview = usePreview(listingId, mp);
  const patch = usePatchTarget();
  const ml = listing?.marketplaces.find((m) => m.marketplaceId === mp);
  const [title, setTitle] = useState(ml?.titleOverride ?? '');
  const [desc, setDesc] = useState(ml?.descriptionOverride ?? '');
  useEffect(() => { setTitle(ml?.titleOverride ?? ''); setDesc(ml?.descriptionOverride ?? ''); }, [ml?.titleOverride, ml?.descriptionOverride]);
  if (!info) return null;
  const save = (p: Parameters<typeof patch.mutate>[0]['patch']) => patch.mutate({ id: listingId, mp, patch: p });
  const p = preview.data;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">Preview</h3>
        {!p ? <p className="text-sm text-zinc-500">Loading…</p> : (
          <div className="card space-y-3 p-3 text-sm">
            <div><span className="text-xs text-zinc-500">Title</span><div className="font-medium">{p.title || '—'}{p.titleTruncated && <span className="pill ml-2 bg-amber-100 text-amber-800">shortened</span>}</div></div>
            <div className="flex gap-6">
              <div><span className="text-xs text-zinc-500">Price</span><div className="font-medium">{p.priceCents === null ? '—' : formatCents(p.priceCents)}</div></div>
              <div><span className="text-xs text-zinc-500">Photos</span><div className="font-medium">{p.photoCount}</div></div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500"><span>Description</span><span className={clsx(p.description.length > info.capabilities.descriptionMaxLength && 'text-red-600')}>{p.description.length} / {info.capabilities.descriptionMaxLength}</span></div>
              <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2">{p.description || '—'}</div>
            </div>
            {p.mapping.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {p.mapping.map((m) => (<div key={m.label} className="contents"><dt className="text-zinc-500">{m.label}</dt><dd>{m.value}</dd></div>))}
              </dl>
            )}
          </div>
        )}
      </section>
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700">Overrides</h3>
        <div>
          <label className="label" htmlFor={`ov-title-${mp}`}>Title override</label>
          <input id={`ov-title-${mp}`} className="input" placeholder={listingTitle} value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== (ml?.titleOverride ?? '')) save({ titleOverride: title }); }} />
        </div>
        <div>
          <label className="label" htmlFor={`ov-desc-${mp}`}>Description override</label>
          <textarea id={`ov-desc-${mp}`} className="input" rows={4} placeholder="Leave empty to use the main description" value={desc} onChange={(e) => setDesc(e.target.value)}
            onBlur={() => { if (desc !== (ml?.descriptionOverride ?? '')) save({ descriptionOverride: desc }); }} />
        </div>
        <div>
          <label className="label" htmlFor={`ov-price-${mp}`}>Price override</label>
          <PriceInput id={`ov-price-${mp}`} value={ml?.priceOverrideCents ?? null} placeholder={p?.priceCents != null ? (p.priceCents / 100).toFixed(2) : undefined}
            onChange={(c) => save({ priceOverrideCents: c })} />
          <p className="help">Empty = use the computed price.</p>
        </div>
      </section>
      {info.dataFields.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700">{info.name} fields</h3>
          {info.dataFields.map((def) => (
            <DataFieldInput key={def.key} def={def} listingId={listingId} marketplaceId={mp} data={ml?.data ?? {}} value={(ml?.data ?? {})[def.key]}
              onCommitMany={(patch) => save({ data: { ...(ml?.data ?? {}), ...patch } })}
              onCommit={(v) => {
                const next = { ...(ml?.data ?? {}) };
                if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[def.key]; else next[def.key] = v;
                save({ data: next });
              }} />
          ))}
        </section>
      )}
    </div>
  );
}

export function OverridesPanel({ listingId, listingTitle, marketplaceIds, active, onTab, onClose }: {
  listingId: string; listingTitle: string; marketplaceIds: MarketplaceId[]; active: MarketplaceId; onTab: (mp: MarketplaceId) => void; onClose: () => void;
}) {
  const infos = useMarketplaces().data ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="flex h-full w-[560px] flex-col bg-white shadow-2xl" aria-label="Marketplace settings">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="font-semibold">Customize per marketplace</h2>
          <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3">
          {marketplaceIds.map((mp) => (
            <button key={mp} role="tab" aria-selected={mp === active} onClick={() => onTab(mp)}
              className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', mp === active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-zinc-600 hover:text-zinc-900')}>
              {infos.find((m) => m.id === mp)?.name ?? mp}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5"><Tab key={active} mp={active} listingId={listingId} listingTitle={listingTitle} /></div>
      </aside>
    </div>
  );
}
