import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { MARKETPLACE_IDS, MARKETPLACE_NAMES } from '../../shared/constants';
import type { Sale } from '../../shared/types';
import { salesQuery, useSales } from '../api/hooks';
import { SaleEditModal } from '../components/SaleEditModal';
import { formatCents } from '../lib/format';

type Period = 'month' | '30d' | 'year' | 'all';

function range(period: Period): { from?: string; to?: string } {
  const now = new Date();
  if (period === 'all') return {};
  if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  if (period === 'year') return { from: new Date(now.getFullYear(), 0, 1).toISOString() };
  return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString() };
}

const SOURCE: Record<Sale['source'], string> = { manual: 'Manual', detected: 'Detected', ebay_api: 'eBay' };
const money = (c: number | null) => (c === null ? '—' : formatCents(c));

export function SalesPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [platform, setPlatform] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Sale | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(text), 250); return () => clearTimeout(t); }, [text]);

  const filters = useMemo(() => ({ ...range(period), marketplaceId: platform || undefined, q: q || undefined }), [period, platform, q]);
  const sales = useSales(filters);
  const items = sales.data?.items ?? [];
  const totals = sales.data?.totals ?? { count: 0, revenueCents: 0, feesCents: 0, netCents: 0 };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sold</h1>
        <a className="btn btn-secondary" href={`/api/sales/export.csv${salesQuery(filters)}`}>Export CSV</a>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input w-44" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="month">This month</option>
          <option value="30d">Last 30 days</option>
          <option value="year">This year</option>
          <option value="all">All time</option>
        </select>
        <select className="input w-48" aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">All platforms</option>
          {MARKETPLACE_IDS.map((id) => <option key={id} value={id}>{MARKETPLACE_NAMES[id]}</option>)}
          <option value="elsewhere">Elsewhere</option>
        </select>
        <input className="input w-64" placeholder="Search title or SKU" aria-label="Search title or SKU" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="card mb-4 flex flex-wrap gap-x-8 gap-y-1 px-4 py-3 text-sm">
        <span>Items sold <b>{totals.count}</b></span>
        <span>Revenue <b>{formatCents(totals.revenueCents)}</b></span>
        <span>Fees <b>{formatCents(totals.feesCents)}</b></span>
        <span>Net <b>{formatCents(totals.netCents)}</b></span>
      </div>
      {items.length === 0 ? (
        <p className="py-10 text-center text-zinc-500">No sales in this period.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Platform</th>
                <th className="px-3 py-2">Sale price</th><th className="px-3 py-2">Shipping paid by buyer</th><th className="px-3 py-2">Fees</th>
                <th className="px-3 py-2">Shipping cost</th><th className="px-3 py-2">Item cost</th><th className="px-3 py-2">Net</th>
                <th className="px-3 py-2">Buyer</th><th className="px-3 py-2">Source</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 align-middle">
                  <td className="whitespace-nowrap px-3 py-2">{new Date(s.soldAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {s.thumbUrl ? <img src={s.thumbUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-zinc-100" />}
                      <div className="min-w-0">
                        {s.listingId ? <Link className="font-medium hover:underline" to={`/listings/${s.listingId}`}>{s.title}</Link> : <span className="font-medium">{s.title}</span>}
                        <div className="text-xs text-zinc-400">{s.sku}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{s.marketplaceId === 'elsewhere' ? 'Elsewhere' : MARKETPLACE_NAMES[s.marketplaceId]}</td>
                  <td className="px-3 py-2">{money(s.salePriceCents)}</td>
                  <td className="px-3 py-2">{money(s.shippingChargedCents)}</td>
                  <td className="px-3 py-2">{money(s.marketplaceFeesCents)}</td>
                  <td className="px-3 py-2">{money(s.shippingCostCents)}</td>
                  <td className="px-3 py-2">{money(s.itemCostCents)}</td>
                  <td className={clsx('px-3 py-2 font-medium', s.netCents !== null && s.netCents > 0 && 'text-green-600', s.netCents !== null && s.netCents < 0 && 'text-red-600')}>{money(s.netCents)}</td>
                  <td className="px-3 py-2">{s.buyer || '—'}</td>
                  <td className="px-3 py-2">{SOURCE[s.source]}</td>
                  <td className="px-3 py-2"><button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SaleEditModal key={editing.id} sale={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
