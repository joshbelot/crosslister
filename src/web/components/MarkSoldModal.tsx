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
  const [shipCharged, setShipCharged] = useState<number | null>(null);
  const [fees, setFees] = useState<number | null>(null);
  const [labelCost, setLabelCost] = useState<number | null>(null);
  const [otherCosts, setOtherCosts] = useState<number | null>(null);
  const [buyer, setBuyer] = useState('');
  const [orderUrl, setOrderUrl] = useState('');
  const [notes, setNotes] = useState('');
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
        ...(shipCharged !== null ? { shippingChargedCents: shipCharged } : {}),
        ...(fees !== null ? { marketplaceFeesCents: fees } : {}),
        ...(labelCost !== null ? { shippingCostCents: labelCost } : {}),
        ...(otherCosts !== null ? { otherCostsCents: otherCosts } : {}),
        ...(buyer.trim() ? { buyer: buyer.trim() } : {}),
        ...(orderUrl.trim() ? { orderUrl: orderUrl.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
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
        <details>
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">More sale details</summary>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div><label className="label" htmlFor="sold-ship-charged">Shipping paid by buyer</label><PriceInput id="sold-ship-charged" value={shipCharged} onChange={setShipCharged} /></div>
            <div><label className="label" htmlFor="sold-fees">Fees</label><PriceInput id="sold-fees" value={fees} onChange={setFees} /></div>
            <div><label className="label" htmlFor="sold-label">Shipping label cost</label><PriceInput id="sold-label" value={labelCost} onChange={setLabelCost} /></div>
            <div><label className="label" htmlFor="sold-other">Other costs</label><PriceInput id="sold-other" value={otherCosts} onChange={setOtherCosts} /></div>
            <div><label className="label" htmlFor="sold-buyer">Buyer</label><input id="sold-buyer" className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} /></div>
            <div><label className="label" htmlFor="sold-order">Order link</label><input id="sold-order" className="input" value={orderUrl} onChange={(e) => setOrderUrl(e.target.value)} /></div>
            <div className="col-span-2"><label className="label" htmlFor="sold-notes">Notes</label><textarea id="sold-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
        </details>
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
