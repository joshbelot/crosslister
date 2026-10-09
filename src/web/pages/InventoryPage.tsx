import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, ImageOff, MoreHorizontal, Pencil, Plus, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { INVENTORY_FILTERS, type InventoryFilter } from '../../shared/constants';
import { useDuplicateListing, useListings, useRunStatusChecks } from '../api/hooks';
import { MarketplaceBadge } from '../components/MarketplaceBadge';
import { StatusPill } from '../components/StatusPill';
import { formatCentsShort } from '../lib/format';
import { useHotkeys } from '../lib/keyboard';

const FILTER_LABELS: Record<InventoryFilter, string> = {
  all: 'All', draft: 'Drafts', listed: 'Listed', partially_listed: 'Partially listed', sold: 'Sold', archived: 'Archived', needs_attention: 'Needs attention',
};
const SORTS: Array<[string, string]> = [
  ['updated_desc', 'Recently updated'], ['created_desc', 'Recently created'], ['price_desc', 'Price high→low'],
  ['price_asc', 'Price low→high'], ['title_asc', 'Title A→Z'],
];

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filter = (INVENTORY_FILTERS as readonly string[]).includes(params.get('filter') ?? '') ? (params.get('filter') as InventoryFilter) : 'all';
  const sort = params.get('sort') ?? 'updated_desc';
  const urlQ = params.get('q') ?? '';
  const [text, setText] = useState(urlQ);
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const duplicate = useDuplicateListing();
  const runChecks = useRunStatusChecks();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (text === urlQ) return;
      setParams((p) => { const n = new URLSearchParams(p); if (text) n.set('q', text); else n.delete('q'); return n; }, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [text, urlQ, setParams]);

  const { data, isLoading, isError } = useListings({ filter, q: urlQ, sort });
  const items = useMemo(() => data?.items ?? [], [data]);
  useEffect(() => { setHighlight((h) => Math.min(h, Math.max(0, items.length - 1))); }, [items.length]);

  const setParam = (key: string, value: string | null) =>
    setParams((p) => { const n = new URLSearchParams(p); if (value && value !== 'all' && value !== 'updated_desc') n.set(key, value); else n.delete(key); return n; }, { replace: true });

  useHotkeys({
    '/': () => searchRef.current?.focus(),
    j: () => setHighlight((h) => Math.min(items.length - 1, h + 1)),
    k: () => setHighlight((h) => Math.max(0, h - 1)),
    enter: () => { const it = items[highlight]; if (it) navigate(`/listings/${it.id}`); },
    e: () => { const it = items[highlight]; if (it) navigate(`/listings/${it.id}/edit`); },
  });

  const counts = data?.counts;
  const totallyEmpty = !isLoading && !isError && items.length === 0 && filter === 'all' && !urlQ;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-zinc-400" />
          <input ref={searchRef} className="input pl-9 pr-10" placeholder="Search inventory…" value={text}
            onChange={(e) => { setText(e.target.value); setHighlight(0); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); (e.target as HTMLElement).blur(); } }} />
          <span className="kbd absolute right-3 top-2.5">/</span>
        </div>
        <select className="input w-52" value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="relative">
          <button className="btn btn-secondary px-3" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><MoreHorizontal size={16} /></button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              <button role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50" disabled={runChecks.isPending}
                onClick={() => { setMenuOpen(false); runChecks.mutate(undefined, { onSuccess: (r) => toast(r.count ? `Checking ${r.count} listing${r.count === 1 ? '' : 's'}…` : 'Nothing to check right now.') }); }}>
                Check listing statuses
              </button>
            </div>
          )}
        </div>
        <Link to="/import" className="btn btn-secondary"><Download size={16} /> Import</Link>
        <Link to="/listings/new/edit" className="btn btn-primary"><Plus size={16} /> New Listing</Link>
      </div>

      <div className="mt-4 flex gap-1 border-b border-zinc-200" role="tablist">
        {INVENTORY_FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', filter === f ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-zinc-600 hover:text-zinc-900')}
            onClick={() => setParam('filter', f)}>
            {FILTER_LABELS[f]}{' '}
            <span className={clsx('ml-0.5 text-xs', f === 'needs_attention' && (counts?.[f] ?? 0) > 0 ? 'font-semibold text-red-600' : 'text-zinc-400')}>{counts?.[f] ?? 0}</span>
          </button>
        ))}
      </div>

      {isError && <p className="mt-6 text-sm text-red-600">Couldn't load your inventory. Is the app server running?</p>}
      {totallyEmpty && (
        <div className="card mt-6 flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-zinc-600">No items yet.</p>
          <Link to="/listings/new/edit" className="btn btn-primary"><Plus size={16} /> New Listing</Link>
          <p className="text-xs text-zinc-500">or press <span className="kbd">N</span></p>
        </div>
      )}
      {!totallyEmpty && !isLoading && items.length === 0 && <p className="mt-8 text-center text-sm text-zinc-500">Nothing matches.</p>}

      <ul className="mt-3 space-y-2">
        {items.map((it, i) => (
          <li key={it.id}>
            <div role="link" tabIndex={0} data-testid="inventory-row"
              className={clsx('group card flex h-20 cursor-pointer items-center gap-4 px-3 hover:border-indigo-300', i === highlight && 'ring-2 ring-indigo-400')}
              onClick={() => navigate(`/listings/${it.id}`)}
              onMouseEnter={() => setHighlight(i)}>
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 text-zinc-300">
                {it.primaryPhotoUrl ? <img src={it.primaryPhotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageOff size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{it.title || <span className="text-zinc-400">Untitled</span>}</span>
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{it.sku}</span>
                  {it.needsAttention && <span className="pill bg-red-100 text-red-700">Needs attention</span>}
                </div>
                <div className="truncate text-sm text-zinc-500">{[it.brand, it.size].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="hidden w-48 flex-wrap justify-end gap-1 lg:flex">
                {it.marketplaces.map((m) => <MarketplaceBadge key={m.marketplaceId} marketplaceId={m.marketplaceId} status={m.status} url={m.url} />)}
              </div>
              <div className="w-20 text-right text-sm font-medium">{formatCentsShort(it.priceCents)}</div>
              <div className="w-32 text-right"><StatusPill status={it.status} /></div>
              <div className="flex w-24 justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button className="btn btn-ghost btn-sm !px-2" title="Edit" aria-label="Edit" onClick={(e) => { e.stopPropagation(); navigate(`/listings/${it.id}/edit`); }}><Pencil size={15} /></button>
                <button className="btn btn-ghost btn-sm !px-2" title="Cross-list" aria-label="Cross-list" onClick={(e) => { e.stopPropagation(); navigate(`/listings/${it.id}/edit?crosslist=1`); }}><Send size={15} /></button>
                <button className="btn btn-ghost btn-sm !px-2" title="Duplicate" aria-label="Duplicate" disabled={duplicate.isPending}
                  onClick={(e) => { e.stopPropagation(); duplicate.mutate(it.id, { onSuccess: (d) => navigate(`/listings/${d.id}/edit`) }); }}><Copy size={15} /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
