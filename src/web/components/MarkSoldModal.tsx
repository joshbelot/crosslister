import { useState } from 'react';
import { toast } from 'sonner';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ListingDetail } from '../../shared/types';
import { useMarkSold, useUnmarkSold } from '../api/hooks';
import { setUi } from '../lib/ui';
import { Modal } from './Modal';
import { PriceInput } from './fields/PriceInput';

const today = () => new Date().toISOString().slice(0, 10);

export function MarkSoldModal({ listing, onClose }: { listing: ListingDetail; onClose: () => void }) {
  const active = listing.marketplaces.filter((m) => m.status === 'active');
  const preselect = listing.saleDetectedMarketplaceId ?? active[0]?.marketplaceId ?? 'elsewhere';
  const [soldOn, setSoldOn] = useState<MarketplaceId | 'elsewhere'>(preselect);
  const [price, setPrice] = useState<number | null>(listing.priceCents);
  const [date, setDate] = useState(today());
  const [priceTouched, setPriceTouched] = useState(false);
  const [checked, setChecked] = useState<Set<MarketplaceId>>(new Set(active.map((m) => m.marketplaceId)));
  const markSold = useMarkSold();
  const unmark = useUnmarkSold();

  const others = active.filter((m) => m.marketplaceId !== soldOn);
  const selectedOthers = others.filter((m) => checked.has(m.marketplaceId));

  const submit = () => {
    markSold.mutate({
      id: listing.id,
      body: {
        marketplaceId: soldOn, soldPriceCents: price,
        soldAt: new Date(`${date}T12:00:00`).toISOString(),
        deactivateMarketplaceIds: selectedOthers.map((m) => m.marketplaceId),
      },
    }, {
      onSuccess: (res) => {
        onClose();
        if (res.jobs.length > 0) setUi({ drawerOpen: true });
        toast.success('Marked sold', {
          duration: 10_000,
          action: { label: 'Undo', onClick: () => unmark.mutate(listing.id) },
        });
      },
    });
  };

  return (
    <Modal title="Mark sold" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={markSold.isPending} autoFocus>
          {selectedOthers.length > 0 ? `Mark sold & remove from ${selectedOthers.length}` : 'Mark sold'}
        </button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="sold-on">Sold on</label>
          <select id="sold-on" className="input" value={soldOn} onChange={(e) => { setSoldOn(e.target.value as MarketplaceId | 'elsewhere'); }}>
            {active.map((m) => <option key={m.marketplaceId} value={m.marketplaceId}>{MARKETPLACE_NAMES[m.marketplaceId]}</option>)}
            <option value="elsewhere">Elsewhere / in person</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sold-price">Sale price</label>
            <PriceInput id="sold-price" value={price} onChange={(c) => { setPrice(c); setPriceTouched(true); }} />
            {!priceTouched && <p className="help">Defaults to the listed price.</p>}
          </div>
          <div>
            <label className="label" htmlFor="sold-date">Date</label>
            <input id="sold-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {others.length > 0 && (
          <fieldset>
            <legend className="label">Remove from other marketplaces</legend>
            <div className="space-y-1.5">
              {others.map((m) => (
                <label key={m.marketplaceId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked.has(m.marketplaceId)}
                    onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(m.marketplaceId); else n.delete(m.marketplaceId); return n; })} />
                  {MARKETPLACE_NAMES[m.marketplaceId]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
