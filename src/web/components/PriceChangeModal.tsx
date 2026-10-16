import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ListingDetail } from '../../shared/types';
import { usePriceChange, usePriceChangePreview } from '../api/hooks';
import { formatCents } from '../lib/format';
import { setUi } from '../lib/ui';
import { Modal } from './Modal';
import { PriceInput } from './fields/PriceInput';

export function PriceChangeModal({ listing, onClose }: { listing: ListingDetail; onClose: () => void }) {
  const current = listing.priceCents ?? 0;
  const [price, setPrice] = useState<number | null>(listing.priceCents);
  const [debounced, setDebounced] = useState<number | null>(listing.priceCents);
  const [clearOverrides, setClearOverrides] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<MarketplaceId>>(new Set());
  const apply = usePriceChange();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(price), 300);
    return () => clearTimeout(t);
  }, [price]);

  const preview = usePriceChangePreview(listing.id, debounced, clearOverrides);
  const rows = preview.data?.items ?? [];
  const active = listing.marketplaces.filter((m) => m.status === 'active');
  const anyOverride = active.some((m) => m.priceOverrideCents !== null);
  const hasPoshmark = active.some((m) => m.marketplaceId === 'poshmark');
  const selected = rows.filter((r) => r.canPush && !unchecked.has(r.marketplaceId));

  const cut = (p: number) => {
    const cents = Math.round(current * (1 - p / 100));
    setPrice(hasPoshmark ? Math.max(100, Math.round(cents / 100) * 100) : Math.max(1, cents));
  };

  const submit = () => {
    if (price === null || price < 1) return;
    apply.mutate({ id: listing.id, body: { priceCents: price, marketplaceIds: selected.map((r) => r.marketplaceId), clearOverrides } }, {
      onSuccess: (res) => {
        onClose();
        toast.success('Price saved');
        if (res.jobs.length > 0) setUi({ drawerOpen: true });
        for (const s of res.skipped) toast.info(`${MARKETPLACE_NAMES[s.marketplaceId]}: ${s.reason}`);
      },
    });
  };

  return (
    <Modal title="Change price" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={apply.isPending || price === null || price < 1}>
          {selected.length > 0 ? `Save and update ${selected.length} marketplace${selected.length === 1 ? '' : 's'}` : 'Save price'}
        </button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">Current price: {formatCents(listing.priceCents)}</p>
        <div>
          <label className="label" htmlFor="new-price">New price</label>
          <PriceInput id="new-price" value={price} onChange={setPrice} />
          <div className="mt-2 flex gap-2">
            {[5, 10, 15, 20].map((p) => <button key={p} type="button" className="btn btn-secondary btn-sm" onClick={() => cut(p)}>−{p}%</button>)}
          </div>
        </div>
        {anyOverride && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={clearOverrides} onChange={(e) => setClearOverrides(e.target.checked)} />
            Also replace prices you set per marketplace
          </label>
        )}
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500">Not listed anywhere yet — this only changes the price in Crosslister.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-zinc-500"><th className="w-8" /><th>Marketplace</th><th>Now</th><th>New</th><th>Note</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.marketplaceId} className="border-t border-zinc-100">
                  <td><input type="checkbox" aria-label={`Update ${r.name}`} disabled={!r.canPush} checked={r.canPush && !unchecked.has(r.marketplaceId)}
                    onChange={(e) => setUnchecked((s) => { const n = new Set(s); if (e.target.checked) n.delete(r.marketplaceId); else n.add(r.marketplaceId); return n; })} /></td>
                  <td>{r.name}</td>
                  <td>{formatCents(r.currentPriceCents)}</td>
                  <td>{formatCents(r.newPriceCents)}</td>
                  <td className="text-zinc-500">
                    {r.note}
                    {r.kind === 'manual' && r.url && <> <a className="underline" href={r.url} target="_blank" rel="noreferrer">Open</a></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
