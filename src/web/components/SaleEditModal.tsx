import { useState } from 'react';
import { MARKETPLACE_IDS, MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { Sale } from '../../shared/types';
import { useUpdateSale } from '../api/hooks';
import { Modal } from './Modal';
import { PriceInput } from './fields/PriceInput';

type MoneyKey = 'salePriceCents' | 'shippingChargedCents' | 'marketplaceFeesCents' | 'shippingCostCents' | 'otherCostsCents' | 'itemCostCents';
const MONEY: Array<[MoneyKey, string]> = [
  ['salePriceCents', 'Sale price'], ['shippingChargedCents', 'Shipping paid by buyer'], ['marketplaceFeesCents', 'Fees'],
  ['shippingCostCents', 'Shipping label cost'], ['otherCostsCents', 'Other costs'], ['itemCostCents', 'Item cost'],
];

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function SaleEditModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const update = useUpdateSale();
  const [soldAt, setSoldAt] = useState(toLocalInput(sale.soldAt));
  const [platform, setPlatform] = useState<MarketplaceId | 'elsewhere'>(sale.marketplaceId);
  const [money, setMoney] = useState<Record<MoneyKey, number | null>>({
    salePriceCents: sale.salePriceCents, shippingChargedCents: sale.shippingChargedCents, marketplaceFeesCents: sale.marketplaceFeesCents,
    shippingCostCents: sale.shippingCostCents, otherCostsCents: sale.otherCostsCents, itemCostCents: sale.itemCostCents,
  });
  const [buyer, setBuyer] = useState(sale.buyer);
  const [orderUrl, setOrderUrl] = useState(sale.orderUrl ?? '');
  const [notes, setNotes] = useState(sale.notes);

  const save = () => {
    update.mutate({
      id: sale.id,
      body: { soldAt: new Date(soldAt).toISOString(), marketplaceId: platform, ...money, buyer, orderUrl: orderUrl.trim() || null, notes },
    }, { onSuccess: onClose });
  };

  return (
    <Modal title="Edit sale" onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={update.isPending}>Save</button></>}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">{sale.title} <span className="text-zinc-400">· {sale.sku}</span></p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sale-date">Date and time</label>
            <input id="sale-date" type="datetime-local" className="input" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="sale-platform">Platform</label>
            <select id="sale-platform" className="input" value={platform} onChange={(e) => setPlatform(e.target.value as MarketplaceId | 'elsewhere')}>
              {MARKETPLACE_IDS.map((id) => <option key={id} value={id}>{MARKETPLACE_NAMES[id]}</option>)}
              <option value="elsewhere">Elsewhere / in person</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {MONEY.map(([key, label]) => (
            <div key={key}>
              <label className="label" htmlFor={`sale-${key}`}>{label}</label>
              <PriceInput id={`sale-${key}`} value={money[key]} onChange={(c) => setMoney((m) => ({ ...m, [key]: c }))} />
            </div>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="sale-buyer">Buyer</label>
          <input id="sale-buyer" className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sale-order">Order link</label>
          <input id="sale-order" className="input" value={orderUrl} onChange={(e) => setOrderUrl(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sale-notes">Notes</label>
          <textarea id="sale-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
