import { useState } from 'react';
import clsx from 'clsx';
import type { MarketplaceId } from '../../../shared/constants';
import { MARKETPLACE_ORDER } from '../../../shared/constants';
import { useMarketplaces } from '../../api/hooks';
import { CategoryMapModal } from './CategoryMapModal';
import { ConnectionControls } from './ConnectionControls';
import { Toggle } from './Toggle';
import type { SettingsDraft } from './useSettingsDraft';

const KIND_TAG = { api: 'API', browser: 'Assisted', manual: 'Manual' } as const;

export function MarketplacesTab({ s }: { s: SettingsDraft }) {
  const infos = useMarketplaces().data ?? [];
  const [mapFor, setMapFor] = useState<MarketplaceId | null>(null);
  const d = s.draft!;
  return (
    <div className="space-y-4">
      {MARKETPLACE_ORDER.map((id) => {
        const info = infos.find((m) => m.id === id);
        if (!info) return null;
        const prefs = d.marketplaces[id];
        const autoDisabled = id === 'facebook' || !info.capabilities.autoSubmitAllowed;
        const example = Math.round(6500 * (1 + prefs.priceAdjustPercent / 100) / 100) * 100;
        const set = (patch: Partial<typeof prefs>) => s.update((x) => { Object.assign(x.marketplaces[id], patch); return x; });
        return (
          <section key={id} className="card p-4" data-testid={`mp-card-${id}`}>
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">{info.name}</h3>
              <span className="rounded bg-zinc-100 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">{KIND_TAG[info.kind]}</span>
              <label className="ml-auto flex items-center gap-2 text-sm">Enabled <Toggle checked={prefs.enabled} onChange={(v) => set({ enabled: v })} label={`Enable ${info.name}`} /></label>
            </div>
            <ConnectionControls info={info} />
            <div className="mt-4 grid grid-cols-[1fr_auto_auto] items-start gap-6">
              <div>
                <div className="flex items-center gap-3 text-sm">
                  <Toggle checked={prefs.autoSubmit && !autoDisabled} disabled={autoDisabled} onChange={(v) => set({ autoSubmit: v })} label="Click the final Publish button for me" />
                  Click the final Publish button for me
                </div>
                <p className="help">
                  {id === 'facebook' ? 'Facebook always requires you to click Publish.'
                    : !info.capabilities.autoSubmitAllowed ? 'Not available: you finish this one yourself.'
                    : 'Off (recommended): the app fills the form and you click Publish.'}
                </p>
              </div>
              <div className="w-40">
                <label className="label" htmlFor={`adj-${id}`}>Price adjustment %</label>
                <input id={`adj-${id}`} className="input" type="number" min={-50} max={100} value={prefs.priceAdjustPercent}
                  onChange={(e) => set({ priceAdjustPercent: Math.min(100, Math.max(-50, Number(e.target.value) || 0)) })} />
                <p className="help">$65.00 → ${(example / 100).toFixed(2)}</p>
              </div>
              <div className="w-28">
                <label className="label" htmlFor={`lim-${id}`}>Daily limit</label>
                <input id={`lim-${id}`} className="input" type="number" min={1} max={200} value={prefs.dailyLimit}
                  onChange={(e) => set({ dailyLimit: Math.min(200, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
              </div>
            </div>
            {info.kind === 'browser' && (
              <button className={clsx('btn btn-secondary btn-sm mt-3')} onClick={() => setMapFor(id)}>Category mapping…</button>
            )}
          </section>
        );
      })}
      {mapFor && <CategoryMapModal mp={mapFor} onClose={() => setMapFor(null)} />}
    </div>
  );
}
