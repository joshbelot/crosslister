import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CONDITIONS, CONDITION_LABELS, MARKETPLACE_IDS, MARKETPLACE_NAMES, type Condition, type MarketplaceId } from '../../shared/constants';
import type { ListingPatch } from '../../shared/schemas';
import { api, ApiError } from '../api/client';
import { useMarketplaces } from '../api/hooks';
import { CategoryPicker } from '../components/fields/CategoryPicker';
import { formatCents, parsePriceToCents } from '../lib/format';

type Method = 'api' | 'shop_page' | 'urls';
interface Suggestion { listingId: string; score: number; reasons: string[]; title: string; priceCents: number | null; thumbUrl: string | null; label: string }
interface Item {
  id: string; state: string; remoteId: string | null; url: string | null; title: string; thumbUrl: string | null; error: string | null;
  existingListingId: string | null; mapped: ListingPatch | null; photoCount: number; suggestions: Suggestion[];
}
interface Batch { id: string; marketplaceId: MarketplaceId; method: Method; state: string; createdAt: string }
interface BatchDetail { batch: Batch; items: Item[] }
interface BatchSummary extends Batch { counts: Record<string, number> }

const URL_ONLY: MarketplaceId[] = ['facebook', 'vinted', 'offerup', 'etsy', 'other'];

export function ImportPage() {
  const qc = useQueryClient();
  const [batchId, setBatchId] = useState<string | null>(null);
  const recent = useQuery({ queryKey: ['import', 'list'], queryFn: async () => (await api.get<{ items: BatchSummary[] }>('/api/import/batches')).items });
  const detail = useQuery({
    queryKey: ['import', batchId], enabled: !!batchId,
    queryFn: () => api.get<BatchDetail>(`/api/import/batches/${batchId}`),
    refetchInterval: (q) => (['scanning', 'fetching'].includes(q.state.data?.batch.state ?? '') ? 2000 : false),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['import'] }); void qc.invalidateQueries({ queryKey: ['listings'] }); };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <h1 className="text-xl font-semibold">Import</h1>
      {!batchId && <SourceStep onStarted={(id) => { setBatchId(id); refresh(); }} />}
      {batchId && detail.data && <BatchView data={detail.data} onChanged={refresh} onClose={() => setBatchId(null)} />}
      {batchId && detail.isPending && <Loader2 className="animate-spin text-zinc-400" />}
      {!batchId && (recent.data?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-700">Recent imports</h2>
          <div className="card divide-y divide-zinc-100">
            {recent.data!.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="font-medium">{MARKETPLACE_NAMES[b.marketplaceId]}</span>
                <span className="text-zinc-500">{new Date(b.createdAt).toLocaleString()}</span>
                <span className="text-zinc-500">{b.state}</span>
                <span className="text-xs text-zinc-500">{Object.entries(b.counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</span>
                <button className="btn btn-secondary btn-sm ml-auto" onClick={() => setBatchId(b.id)}>Open</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => { if (confirm('Delete this import?')) { await api.del(`/api/import/batches/${b.id}`); refresh(); } }}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SourceStep({ onStarted }: { onStarted: (id: string) => void }) {
  const mps = useMarketplaces().data ?? [];
  const [source, setSource] = useState<MarketplaceId | 'backup'>('ebay');
  const [mode, setMode] = useState<Method>('api');
  const [urls, setUrls] = useState('');
  const info = mps.find((m) => m.id === source);
  const scanCapable = source !== 'backup' && ['mercari', 'poshmark', 'depop', 'grailed'].includes(source);
  const effective: Method = source === 'ebay' ? 'api' : scanCapable ? mode : 'urls';
  const ebayBlocked = source === 'ebay' && info?.connection.status !== 'connected';

  const start = useMutation({
    mutationFn: () => api.post<{ batch: Batch }>('/api/import/batches', {
      marketplaceId: source, method: effective, ...(effective === 'urls' ? { urls: urls.split('\n').map((u) => u.trim()).filter(Boolean) } : {}),
    }),
    onSuccess: (r) => onStarted(r.batch.id),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: async (file: File) => api.upload<{ batch: Batch; count: number }>('/api/import/backup', [file]),
    onSuccess: (r) => onStarted(r.batch.id),
    onError: (e: ApiError) => toast.error(e.message),
  });

  useEffect(() => { setMode(source === 'ebay' ? 'api' : 'shop_page'); }, [source]);
  const options: Array<MarketplaceId | 'backup'> = ['ebay', 'mercari', 'poshmark', 'depop', 'grailed', ...URL_ONLY, 'backup'];
  void MARKETPLACE_IDS;

  return (
    <section className="card space-y-4 p-4">
      <h2 className="font-medium">1. Choose a source</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label key={o} className={clsx('cursor-pointer rounded-lg border p-3 text-sm', source === o ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200')}>
            <input type="radio" className="sr-only" name="source" checked={source === o} onChange={() => setSource(o)} />
            <div className="font-medium">{o === 'backup' ? 'Backup' : MARKETPLACE_NAMES[o]}</div>
            <div className="text-xs text-zinc-500">
              {o === 'ebay' ? 'Import active listings via eBay’s API'
                : o === 'backup' ? 'Restore from a Crosslister backup (ZIP or JSON)'
                  : ['mercari', 'poshmark', 'depop', 'grailed'].includes(o) ? 'Scan your shop page in the browser' : 'Paste listing URLs'}
            </div>
          </label>
        ))}
      </div>
      {scanCapable && (
        <div className="flex gap-4 text-sm">
          <label><input type="radio" checked={mode === 'shop_page'} onChange={() => setMode('shop_page')} /> Scan my shop page</label>
          <label><input type="radio" checked={mode === 'urls'} onChange={() => setMode('urls')} /> Paste listing URLs</label>
        </div>
      )}
      {source === 'backup' ? (
        <label className="btn btn-primary cursor-pointer">
          {restore.isPending && <Loader2 className="animate-spin" size={16} />} Choose backup file…
          <input type="file" accept=".zip,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) restore.mutate(f); e.target.value = ''; }} />
        </label>
      ) : (
        <>
          {effective === 'urls' && <textarea className="input" rows={6} placeholder="One listing URL per line" value={urls} onChange={(e) => setUrls(e.target.value)} />}
          {ebayBlocked && <p className="text-xs text-amber-700">Connect eBay in Settings first.</p>}
          <button className="btn btn-primary" disabled={start.isPending || ebayBlocked || (effective === 'urls' && !urls.trim())} onClick={() => start.mutate()}>
            {start.isPending && <Loader2 className="animate-spin" size={16} />} Start
          </button>
        </>
      )}
    </section>
  );
}

function BatchView({ data, onChanged, onClose }: { data: BatchDetail; onChanged: () => void; onClose: () => void }) {
  const { batch, items } = data;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const discovered = items.filter((i) => i.state === 'discovered');
  const fetched = items.filter((i) => i.state === 'fetched');
  const failed = items.filter((i) => i.state === 'failed');
  const noDupes = fetched.filter((i) => !i.existingListingId && !i.suggestions.some((s) => s.score >= 0.45));

  const fetchMut = useMutation({
    mutationFn: (ids: string[]) => api.post(`/api/import/batches/${batch.id}/fetch`, { itemIds: ids }),
    onSuccess: () => { setSelected(new Set()); onChanged(); },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const all = useMutation({
    mutationFn: () => api.post<{ imported: number }>(`/api/import/batches/${batch.id}/commit-all`, { mode: 'new_without_duplicates' }),
    onSuccess: (r) => { toast.success(`Imported ${r.imported} listings.`); onChanged(); },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const busy = batch.state === 'scanning' || batch.state === 'fetching';
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-medium">{MARKETPLACE_NAMES[batch.marketplaceId]} import</h2>
        <span className="text-sm text-zinc-500">{batch.state}</span>
        {busy && <Loader2 className="animate-spin text-zinc-400" size={16} />}
        <button className="btn btn-secondary btn-sm ml-auto" onClick={onClose}>Back</button>
      </div>
      {batch.state === 'scanning' && <p className="text-sm text-zinc-600">Scanning… {items.length > 0 && `Found ${items.length} listings…`}</p>}
      {batch.state === 'failed' && <p className="text-sm text-red-600">The scan didn’t finish. Check the Activity drawer for details.</p>}

      {discovered.length > 0 && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">2. Select listings</span>
            <button className="text-indigo-600" onClick={() => setSelected(new Set(discovered.map((i) => i.id)))}>Select all</button>
            <button className="text-indigo-600" onClick={() => setSelected(new Set())}>Select none</button>
            <button className="btn btn-primary ml-auto" disabled={selected.size === 0 || fetchMut.isPending} onClick={() => fetchMut.mutate([...selected])}>
              Import selected ({selected.size})
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {discovered.map((i) => (
              <label key={i.id} className={clsx('cursor-pointer rounded-lg border p-2 text-xs', selected.has(i.id) ? 'border-indigo-500' : 'border-zinc-200')}>
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                {i.thumbUrl && <img src={i.thumbUrl} alt="" className="mt-1 aspect-square w-full rounded object-cover" referrerPolicy="no-referrer" />}
                <div className="mt-1 line-clamp-2">{i.title}</div>
                {i.existingListingId && <span className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">Already in inventory</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {(fetched.length > 0 || failed.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="font-medium">3. Review</span>
            <button className="btn btn-primary ml-auto" disabled={noDupes.length === 0 || all.isPending} onClick={() => all.mutate()}>
              {all.isPending && <Loader2 className="animate-spin" size={16} />} Import all without duplicates ({noDupes.length})
            </button>
          </div>
          {fetched.map((i) => <ReviewCard key={i.id} item={i} batchId={batch.id} onChanged={onChanged} />)}
          {failed.map((i) => (
            <div key={i.id} className="card flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.title}</div><div className="text-xs text-red-600">{i.error}</div></div>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchMut.mutate([i.id])}>Retry</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewCard({ item, batchId, onChanged }: { item: Item; batchId: string; onChanged: () => void }) {
  void batchId;
  const m = item.mapped ?? {};
  const [title, setTitle] = useState(m.title ?? '');
  const [price, setPrice] = useState(m.priceCents != null ? (m.priceCents / 100).toFixed(2) : '');
  const [condition, setCondition] = useState<Condition | ''>(m.condition ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(m.categoryId ?? null);
  const [brand, setBrand] = useState(m.brand ?? '');
  const [size, setSize] = useState(m.size ?? '');

  const overrides = (): ListingPatch => ({
    title, brand, size, categoryId, ...(condition ? { condition } : {}), priceCents: parsePriceToCents(price),
  } as ListingPatch);
  const commit = useMutation({
    mutationFn: (body: { action: 'new' | 'merge' | 'skip'; targetListingId?: string }) =>
      api.post(`/api/import/items/${item.id}/commit`, { ...body, ...(body.action === 'skip' ? {} : { overrides: overrides() }) }),
    onSuccess: onChanged,
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex gap-2 overflow-x-auto">
        {Array.from({ length: Math.min(item.photoCount, 8) }, (_, n) => (
          <img key={n} src={`/api/import/items/${item.id}/photos/${n}`} alt="" className="h-20 w-20 flex-none rounded object-cover" />
        ))}
        {item.photoCount === 0 && <span className="text-xs text-zinc-500">No photos found</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-2">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="text-sm">Price<input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={m.priceCents == null ? 'Add price' : formatCents(m.priceCents)} /></label>
        <label className="text-sm">Condition
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as Condition | '')}>
            <option value="">Choose…</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </select>
        </label>
        <div className="text-sm">Category<CategoryPicker value={categoryId} onChange={setCategoryId} /></div>
        <label className="text-sm">Brand<input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        <label className="text-sm">Size<input className="input" value={size} onChange={(e) => setSize(e.target.value)} /></label>
      </div>
      {item.existingListingId && <p className="text-xs text-amber-700">Already linked to an item in your inventory.</p>}
      {item.suggestions.map((s) => (
        <div key={s.listingId} className="flex items-center gap-3 rounded-lg bg-zinc-50 p-2 text-sm">
          {s.thumbUrl && <img src={s.thumbUrl} alt="" className="h-12 w-12 rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="truncate">{s.title} {s.priceCents != null && <span className="text-zinc-500">{formatCents(s.priceCents)}</span>}</div>
            <div className="text-xs text-zinc-500">{s.label} · {s.reasons.join(', ')}</div>
          </div>
          <button className="btn btn-secondary btn-sm" disabled={commit.isPending} onClick={() => commit.mutate({ action: 'merge', targetListingId: s.listingId })}>Merge into this item</button>
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={commit.isPending} onClick={() => commit.mutate({ action: 'new' })}>Import as new</button>
        <button className="btn btn-secondary" disabled={commit.isPending} onClick={() => commit.mutate({ action: 'skip' })}>Skip</button>
      </div>
    </div>
  );
}
