import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useMarketplaces } from '../../api/hooks';
import { ConnectionControls } from './ConnectionControls';
import { Toggle } from './Toggle';
import type { SettingsDraft } from './useSettingsDraft';

interface Policies { fulfillment: Array<{ id: string; name: string }>; payment: Array<{ id: string; name: string }>; return: Array<{ id: string; name: string }> }

function PolicySelect({ id, label, value, options, disabled, onChange }: {
  id: string; label: string; value: string | null; options: Array<{ id: string; name: string }>; disabled: boolean; onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose…</option>
        {value && !options.some((o) => o.id === value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

export function EbayTab({ s }: { s: SettingsDraft }) {
  const d = s.draft!;
  const qc = useQueryClient();
  const info = (useMarketplaces().data ?? []).find((m) => m.id === 'ebay');
  const status = useQuery({ queryKey: ['ebay', 'status'], queryFn: () => api.get<{ configured: boolean; missing: string[]; env: string }>('/api/marketplaces/ebay/status') });
  const connected = info?.connection.status === 'connected';
  const policies = useQuery({ queryKey: ['ebay', 'policies'], queryFn: () => api.get<Policies>('/api/marketplaces/ebay/policies'), enabled: connected, retry: false });
  const e = d.ebay;
  const set = (patch: Partial<typeof e>) => s.update((x) => { Object.assign(x.ebay, patch); return x; });
  const Row = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <div className="flex items-start gap-2">{ok ? <CheckCircle2 size={18} className="mt-0.5 text-green-600" /> : <XCircle size={18} className="mt-0.5 text-red-500" />}<div className="flex-1">{children}</div></div>
  );
  return (
    <div className="max-w-2xl space-y-6">
      <section className="card p-4">
        <h3 className="mb-2 font-semibold">1. App credentials</h3>
        <Row ok={!!status.data?.configured}>
          {status.data?.configured
            ? <p className="text-sm">Configured ({status.data.env}).</p>
            : <p className="text-sm">Missing in <span className="font-mono">.env</span>: <span className="font-mono">{(status.data?.missing ?? []).join(', ') || '…'}</span>. See docs/SETUP.md → Connect eBay.</p>}
        </Row>
      </section>
      <section className="card p-4">
        <h3 className="mb-2 font-semibold">2. Account</h3>
        {info ? <ConnectionControls info={info} /> : <p className="text-sm text-zinc-500">Loading…</p>}
      </section>
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">3. Business policies</h3>
          <button className="btn btn-secondary btn-sm" disabled={!connected || policies.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: ['ebay', 'policies'] })}>Refresh</button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <PolicySelect id="pol-ship" label="Shipping" value={e.fulfillmentPolicyId} options={policies.data?.fulfillment ?? []} disabled={!connected} onChange={(v) => set({ fulfillmentPolicyId: v })} />
          <PolicySelect id="pol-pay" label="Payment" value={e.paymentPolicyId} options={policies.data?.payment ?? []} disabled={!connected} onChange={(v) => set({ paymentPolicyId: v })} />
          <PolicySelect id="pol-ret" label="Return" value={e.returnPolicyId} options={policies.data?.return ?? []} disabled={!connected} onChange={(v) => set({ returnPolicyId: v })} />
        </div>
        {policies.isError && <p className="error-text">Couldn't load your policies from eBay.</p>}
        <p className="help">Create these once in eBay Seller Hub → Account → Business policies.</p>
      </section>
      <section className="card p-4">
        <h3 className="mb-2 font-semibold">4. Item location and handling</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ebay-zip">Item location ZIP</label>
            <input id="ebay-zip" className="input" maxLength={5} value={e.postalCode} onChange={(ev) => set({ postalCode: ev.target.value.replace(/\D/g, '') })} /></div>
          <div><label className="label" htmlFor="ebay-dispatch">Handling time (days)</label>
            <input id="ebay-dispatch" type="number" min={0} max={30} className="input" value={e.dispatchTimeDays} onChange={(ev) => set({ dispatchTimeDays: Math.min(30, Math.max(0, Math.round(Number(ev.target.value)) || 0)) })} /></div>
        </div>
      </section>
      <section className="card p-4">
        <h3 className="mb-2 font-semibold">5. Sale detection</h3>
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={d.statusChecks.ebayPollingEnabled} label="Check eBay for sales automatically"
            onChange={(v) => s.update((x) => { x.statusChecks.ebayPollingEnabled = v; return x; })} /> Check eBay for sales automatically
        </label>
        <div className="mt-3 w-48">
          <label className="label" htmlFor="ebay-interval">Every (minutes)</label>
          <input id="ebay-interval" type="number" min={15} max={1440} className="input" disabled={!d.statusChecks.ebayPollingEnabled} value={d.statusChecks.ebayIntervalMinutes}
            onChange={(ev) => s.update((x) => { x.statusChecks.ebayIntervalMinutes = Math.min(1440, Math.max(15, Math.round(Number(ev.target.value)) || 30)); return x; })} />
        </div>
        <p className="help">Only eBay is checked on a timer. Other marketplaces are checked when you choose “Check listing statuses” in Inventory. Sales are never marked automatically.</p>
      </section>
    </div>
  );
}
