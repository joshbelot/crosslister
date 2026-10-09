import { useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Copy as CopyIcon, ExternalLink, MoreHorizontal, Pencil, Send, Tag, Trash2, Undo2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import clsx from 'clsx';
import { COLORS } from '../../shared/colors';
import { CONDITION_LABELS, MARKETPLACE_NAMES, MARKETPLACE_ORDER, type MarketplaceId } from '../../shared/constants';
import { categoryPathLabel } from '../../shared/taxonomy';
import type { MarketplaceListing } from '../../shared/types';
import { ApiError } from '../api/client';
import {
  useArchive, useCrosslist, useDeactivate, useDeleteListing, useDuplicateListing, useJobs, useListing, useMarkEnded, useMarkListed,
  useMarketplaces, useRemoveTarget, useSetTargets, useUnmarkSold, useUpdateRemote,
} from '../api/hooks';
import { DeactivateAllModal } from '../components/DeactivateAllModal';
import { MarkSoldModal } from '../components/MarkSoldModal';
import { MarketplaceBadge } from '../components/MarketplaceBadge';
import { Modal } from '../components/Modal';
import { StatusPill } from '../components/StatusPill';
import { formatCents, formatCentsShort, formatDate, formatWeight, timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/keyboard';
import { setUi } from '../lib/ui';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-zinc-100 py-2 text-sm last:border-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function TargetActions({ listingId, ml, capsUpdate, kind }: { listingId: string; ml: MarketplaceListing; capsUpdate: boolean; kind: string }) {
  const navigate = useNavigate();
  const crosslist = useCrosslist();
  const deactivate = useDeactivate();
  const update = useUpdateRemote();
  const ended = useMarkEnded();
  const remove = useRemoveTarget();
  const markListed = useMarkListed();
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const mp = ml.marketplaceId;

  const doCrosslist = () => crosslist.mutate({ id: listingId, marketplaceIds: [mp] }, {
    onSuccess: (res) => { setUi({ drawerOpen: true }); res.skipped.forEach((s) => toast.info(`${MARKETPLACE_NAMES[s.marketplaceId]}: ${s.reason}`)); },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NOT_READY') { toast.error('That marketplace needs more information.'); navigate(`/listings/${listingId}/edit?crosslist=1`); }
      else toast.error(err instanceof Error ? err.message : 'Cross-listing failed.');
    },
  });
  const btn = 'btn btn-secondary btn-sm';
  const confirmRemove = () => { if (window.confirm(`Remove ${MARKETPLACE_NAMES[mp]} from this item's marketplaces?`)) remove.mutate({ id: listingId, mp }); };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {ml.status === 'not_listed' && <><button className={btn} onClick={doCrosslist} disabled={crosslist.isPending}>Cross-list</button><button className={btn} onClick={confirmRemove}>Remove</button></>}
      {ml.status === 'in_progress' && <button className={btn} onClick={() => setUi({ drawerOpen: true })}>View progress</button>}
      {ml.status === 'active' && (
        <>
          {capsUpdate && <button className={btn} disabled={update.isPending} onClick={() => update.mutate({ id: listingId, mp }, { onSuccess: () => setUi({ drawerOpen: true }) })}>Update</button>}
          <button className={btn} disabled={deactivate.isPending} onClick={() => deactivate.mutate({ id: listingId, mp }, { onSuccess: () => setUi({ drawerOpen: true }) })}>Deactivate</button>
          {kind === 'manual' && <button className={btn} onClick={() => ended.mutate({ id: listingId, mp })}>Mark as ended</button>}
          {!ml.verified && <button className={btn} onClick={() => setUrlOpen((o) => !o)}>Add URL</button>}
        </>
      )}
      {ml.status === 'error' && (
        <>
          <button className={btn} onClick={doCrosslist} disabled={crosslist.isPending}>Retry</button>
          <button className={btn} onClick={() => setUrlOpen((o) => !o)}>Mark as listed…</button>
          <button className={btn} onClick={confirmRemove}>Remove</button>
        </>
      )}
      {(ml.status === 'sold' || ml.status === 'ended') && <><button className={btn} onClick={doCrosslist} disabled={crosslist.isPending}>Relist</button><button className={btn} onClick={confirmRemove}>Remove</button></>}
      {urlOpen && (
        <div className="flex w-full gap-1.5">
          <input className="input h-8 text-xs" placeholder="Listing URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Listing URL" />
          <button className="btn btn-primary btn-sm" disabled={markListed.isPending} onClick={() => markListed.mutate({ id: listingId, mp, url: url.trim() || null }, { onSuccess: () => { setUrlOpen(false); setUrl(''); } })}>Save</button>
        </div>
      )}
    </div>
  );
}

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: l, isLoading, isError } = useListing(id);
  const marketplaces = useMarketplaces().data ?? [];
  const jobs = useJobs({ listingId: id });
  const duplicate = useDuplicateListing();
  const archive = useArchive();
  const del = useDeleteListing();
  const unmark = useUnmarkSold();
  const setTargets = useSetTargets();
  const crosslist = useCrosslist();
  const [photoIdx, setPhotoIdx] = useState(0);
  const [menu, setMenu] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [deactOpen, setDeactOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useHotkeys({
    e: () => navigate(`/listings/${id}/edit`),
    'mod+enter': () => navigate(`/listings/${id}/edit?crosslist=1`),
  });

  if (isLoading) return <div className="p-8 text-center text-zinc-500">Loading…</div>;
  if (isError || !l) return <div className="p-8 text-center text-zinc-600">That listing was not found. <Link className="text-indigo-600 underline" to="/">Back to inventory</Link></div>;

  const photo = l.photos[Math.min(photoIdx, l.photos.length - 1)];
  const activeCount = l.marketplaces.filter((m) => m.status === 'active').length;
  const infoOf = (mp: MarketplaceId) => marketplaces.find((m) => m.id === mp);
  const notTargeted = marketplaces.filter((m) => m.prefs.enabled && !l.marketplaces.some((x) => x.marketplaceId === m.id));
  const sortedTargets = [...l.marketplaces].sort((a, b) => MARKETPLACE_ORDER.indexOf(a.marketplaceId) - MARKETPLACE_ORDER.indexOf(b.marketplaceId));

  const onDelete = async () => {
    if (!window.confirm('Delete this listing and its photos? This cannot be undone.')) return;
    try {
      await del.mutateAsync({ id: l.id });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LISTING_HAS_ACTIVE') {
        const live = l.marketplaces.filter((m) => m.status === 'active').map((m) => MARKETPLACE_NAMES[m.marketplaceId]).join(', ');
        if (!window.confirm(`It's still live on ${live}. Delete anyway?`)) return;
        await del.mutateAsync({ id: l.id, force: true });
      } else { toast.error(err instanceof Error ? err.message : 'Could not delete.'); return; }
    }
    toast.success('Listing deleted');
    navigate('/');
  };

  const addAndCrosslist = async (mp: MarketplaceId) => {
    try {
      await setTargets.mutateAsync({ id: l.id, marketplaceIds: [...l.marketplaces.map((m) => m.marketplaceId), mp] });
      const res = await crosslist.mutateAsync({ id: l.id, marketplaceIds: [mp] });
      setUi({ drawerOpen: true });
      res.skipped.forEach((s) => toast.info(`${MARKETPLACE_NAMES[s.marketplaceId]}: ${s.reason}`));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_READY') { toast.error('That marketplace needs more information.'); navigate(`/listings/${l.id}/edit?crosslist=1`); }
      else toast.error(err instanceof Error ? err.message : 'Cross-listing failed.');
    }
  };

  const m = l.measurements as Record<string, number | undefined>;
  const measurementText = Object.entries(m).filter(([, v]) => v !== undefined).map(([k, v]) => `${k.replace(/In$/, '')} ${v}"`).join(' · ');
  const s = l.shipping;
  const dims = [s.lengthIn, s.widthIn, s.heightIn].every((x) => x !== null) ? `${s.lengthIn} × ${s.widthIn} × ${s.heightIn} in` : '';

  return (
    <div className="mx-auto max-w-5xl px-6 pb-16 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold">{l.title || 'Untitled listing'}</h1>
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600">{l.sku}</span>
            <StatusPill status={l.status} />
          </div>
          <div className="mt-1 text-lg font-medium">{formatCentsShort(l.priceCents)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn btn-secondary" to={`/listings/${l.id}/edit`}><Pencil size={15} /> Edit</Link>
          <Link className="btn btn-secondary" to={`/listings/${l.id}/edit?crosslist=1`}><Send size={15} /> Cross-list</Link>
          <button className="btn btn-secondary" disabled={duplicate.isPending} onClick={() => duplicate.mutate(l.id, { onSuccess: (d) => navigate(`/listings/${d.id}/edit`) })}><CopyIcon size={15} /> Duplicate</button>
          {l.soldAt
            ? <button className="btn btn-secondary" disabled={unmark.isPending} onClick={() => unmark.mutate(l.id)}><Undo2 size={15} /> Undo sold</button>
            : <button className="btn btn-secondary" onClick={() => setSoldOpen(true)}><Tag size={15} /> Mark Sold</button>}
          {activeCount > 0 && <button className="btn btn-secondary" onClick={() => setDeactOpen(true)}>Deactivate Everywhere</button>}
          <div className="relative">
            <button className="btn btn-secondary !px-2" aria-label="More actions" onClick={() => setMenu((o) => !o)}><MoreHorizontal size={16} /></button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50" onClick={() => { setMenu(false); archive.mutate({ id: l.id, archive: !l.archivedAt }); }}><Archive size={14} /> {l.archivedAt ? 'Unarchive' : 'Archive'}</button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-50" onClick={() => { setMenu(false); void onDelete(); }}><Trash2 size={14} /> Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6">
        <section aria-label="Photos">
          {photo ? (
            <>
              <button className="block w-full overflow-hidden rounded-xl border border-zinc-200 bg-white" onClick={() => setLightbox(true)}>
                <img src={photo.urls.display} alt="" className="aspect-square w-full object-contain" />
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                {l.photos.map((p, i) => (
                  <button key={p.id} onClick={() => setPhotoIdx(i)} className={clsx('h-16 w-16 overflow-hidden rounded-lg border-2', i === photoIdx ? 'border-indigo-600' : 'border-transparent')}>
                    <img src={p.urls.thumb} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          ) : <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-zinc-300 text-zinc-400">No photos</div>}
        </section>

        <section className="card p-4" aria-label="Details">
          <dl>
            <Row label="Condition">{l.condition ? CONDITION_LABELS[l.condition] : '—'}</Row>
            <Row label="Category">{l.categoryId ? categoryPathLabel(l.categoryId) : '—'}</Row>
            <Row label="Brand">{l.brand || '—'}</Row>
            <Row label="Size">{l.size || '—'}</Row>
            <Row label="Colors">{l.colors.length ? <span className="flex flex-wrap gap-2">{l.colors.map((c) => { const col = COLORS.find((x) => x.id === c)!; return <span key={c} className="inline-flex items-center gap-1"><span className="h-3.5 w-3.5 rounded-full border border-zinc-300" style={{ background: col.hex === 'conic-gradient' ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : col.hex }} />{col.label}</span>; })}</span> : '—'}</Row>
            {l.model && <Row label="Model">{l.model}</Row>}
            {l.material && <Row label="Material">{l.material}</Row>}
            <Row label="Quantity">{l.quantity}</Row>
            {l.msrpCents !== null && <Row label="MSRP">{formatCents(l.msrpCents)}</Row>}
            {l.costCents !== null && <Row label="Cost"><span className="pill mr-2 bg-zinc-100 text-zinc-600">Private</span>{formatCents(l.costCents)}</Row>}
            {measurementText && <Row label="Measurements">{measurementText}</Row>}
            {l.tags.length > 0 && <Row label="Tags"><span className="flex flex-wrap gap-1">{l.tags.map((t) => <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{t}</span>)}</span></Row>}
            <Row label="Shipping">{[formatWeight(s.weightOz), dims, `${s.whoPays === 'buyer' ? 'Buyer' : 'Seller'} pays`].filter(Boolean).join(' · ')}</Row>
            {l.soldAt && <Row label="Sold">{formatDate(l.soldAt)} · {formatCents(l.soldPriceCents)} · {l.soldMarketplaceId === 'elsewhere' ? 'Elsewhere' : l.soldMarketplaceId ? MARKETPLACE_NAMES[l.soldMarketplaceId] : ''}</Row>}
          </dl>
          {l.notes && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><span className="pill mb-1 bg-amber-100 text-amber-800">Private</span><p className="whitespace-pre-wrap">{l.notes}</p></div>}
        </section>
      </div>

      <section className="card mt-6 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Description</h2>
        <p className="whitespace-pre-wrap text-sm">{l.description || <span className="text-zinc-400">No description.</span>}</p>
        {l.conditionNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600"><span className="font-medium">Condition notes:</span> {l.conditionNotes}</p>}
      </section>

      <section className="card mt-6 overflow-hidden">
        <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-700">Marketplaces</h2>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr><th className="px-4 py-2">Marketplace</th><th className="px-2">Status</th><th className="px-2">Listing ID</th><th className="px-2">Link</th><th className="px-2">Last sync</th><th className="px-2">Error</th><th className="px-4 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {sortedTargets.map((ml) => {
              const info = infoOf(ml.marketplaceId);
              return (
                <tr key={ml.id} className="border-t border-zinc-100 align-top" data-testid={`target-${ml.marketplaceId}`}>
                  <td className="px-4 py-3 font-medium">{MARKETPLACE_NAMES[ml.marketplaceId]}</td>
                  <td className="px-2 py-3"><MarketplaceBadge marketplaceId={ml.marketplaceId} status={ml.status} />{ml.status === 'active' && !ml.verified && <span className="ml-1 text-xs text-amber-600">(unverified)</span>}</td>
                  <td className="px-2 py-3 font-mono text-xs">{ml.remoteId ? <button className="inline-flex items-center gap-1 hover:text-indigo-600" title="Copy" onClick={() => { void navigator.clipboard.writeText(ml.remoteId!); toast.success('Copied listing ID'); }}>{ml.remoteId} <CopyIcon size={11} /></button> : '—'}</td>
                  <td className="px-2 py-3">{ml.url ? <a className="inline-flex items-center gap-1 text-indigo-600 hover:underline" href={ml.url} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a> : '—'}</td>
                  <td className="px-2 py-3 text-zinc-500">{ml.lastSyncedAt ? timeAgo(ml.lastSyncedAt) : '—'}</td>
                  <td className="max-w-[220px] px-2 py-3 text-xs text-red-600">{ml.lastError}</td>
                  <td className="px-4 py-3"><TargetActions listingId={l.id} ml={ml} capsUpdate={Boolean(info && info.capabilities.update !== 'none')} kind={info?.kind ?? 'manual'} /></td>
                </tr>
              );
            })}
            {notTargeted.map((m) => (
              <tr key={m.id} className="border-t border-zinc-100 text-zinc-400">
                <td className="px-4 py-2">{m.name}</td><td className="px-2 py-2">Not listed</td><td colSpan={4} />
                <td className="px-4 py-2 text-right"><button className="btn btn-secondary btn-sm" disabled={setTargets.isPending || crosslist.isPending} onClick={() => void addAndCrosslist(m.id)}>Add &amp; cross-list</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mt-6">
        <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-zinc-700" onClick={() => setHistoryOpen((o) => !o)}>
          {historyOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} History
        </button>
        {historyOpen && (
          <div className="border-t border-zinc-100 px-4 py-2">
            {(jobs.data ?? []).length === 0 && <p className="py-2 text-sm text-zinc-500">No activity yet.</p>}
            <ul className="divide-y divide-zinc-100 text-sm">
              {(jobs.data ?? []).map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-2">
                  <span className="w-40 text-zinc-500">{formatDate(j.createdAt)}</span>
                  <span className="w-28">{j.marketplaceId ? MARKETPLACE_NAMES[j.marketplaceId] : '—'}</span>
                  <span className="w-24 capitalize">{j.type.replace('_', ' ')}</span>
                  <span className="w-24">{j.state}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-red-600">{j.errorMessage}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {soldOpen && <MarkSoldModal listing={l} onClose={() => setSoldOpen(false)} />}
      {deactOpen && <DeactivateAllModal listing={l} onClose={() => setDeactOpen(false)} />}
      {lightbox && photo && (
        <Modal title="Photo" onClose={() => setLightbox(false)} wide><img src={photo.urls.display} alt="" className="mx-auto max-h-[70vh] object-contain" /></Modal>
      )}
    </div>
  );
}
