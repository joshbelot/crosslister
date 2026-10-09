import { MARKETPLACE_NAMES, MARKETPLACE_ORDER } from '../../../shared/constants';
import { Toggle } from './Toggle';
import type { SettingsDraft } from './useSettingsDraft';
import clsx from 'clsx';

const num = (v: string): number | null => { const n = Number(v); return v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n; };

export function GeneralTab({ s }: { s: SettingsDraft }) {
  const d = s.draft!;
  const sh = d.shippingDefaults;
  const lb = sh.weightOz === null ? '' : String(Math.floor(sh.weightOz / 16));
  const oz = sh.weightOz === null ? '' : String(Math.round((sh.weightOz % 16) * 10) / 10);
  const setWeight = (l: string, o: string) => s.update((x) => { x.shippingDefaults.weightOz = l.trim() === '' && o.trim() === '' ? null : ((Number(l) || 0) * 16 + (Number(o) || 0)) || null; return x; });
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 font-semibold">Shipping defaults</h3>
        <div className="grid max-w-2xl grid-cols-5 gap-3">
          <div><label className="label" htmlFor="sd-lb">Weight (lb)</label><input id="sd-lb" className="input" value={lb} onChange={(e) => setWeight(e.target.value, oz)} /></div>
          <div><label className="label" htmlFor="sd-oz">Weight (oz)</label><input id="sd-oz" className="input" value={oz} onChange={(e) => setWeight(lb, e.target.value)} /></div>
          {(['lengthIn', 'widthIn', 'heightIn'] as const).map((k) => (
            <div key={k}><label className="label" htmlFor={`sd-${k}`}>{k === 'lengthIn' ? 'Length' : k === 'widthIn' ? 'Width' : 'Height'} (in)</label>
              <input id={`sd-${k}`} className="input" value={sh[k] ?? ''} onChange={(e) => s.update((x) => { x.shippingDefaults[k] = num(e.target.value); return x; })} /></div>
          ))}
        </div>
        <div className="mt-3 flex overflow-hidden rounded-lg border border-zinc-300 w-56" role="radiogroup" aria-label="Who pays shipping">
          {(['buyer', 'seller'] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={sh.whoPays === w} onClick={() => s.update((x) => { x.shippingDefaults.whoPays = w; return x; })}
              className={clsx('h-10 flex-1 text-sm capitalize', sh.whoPays === w ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-zinc-50')}>{w} pays</button>
          ))}
        </div>
      </section>

      <section className="max-w-2xl">
        <label className="label" htmlFor="footer">Description footer</label>
        <textarea id="footer" className="input" rows={3} maxLength={500} value={d.descriptionFooter} onChange={(e) => s.update((x) => { x.descriptionFooter = e.target.value; return x; })} />
        <div className="flex justify-between"><p className="help">Added to the end of every description</p><span className="mt-1 text-xs text-zinc-400">{d.descriptionFooter.length} / 500</span></div>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Default marketplaces</h3>
        <div className="flex flex-wrap gap-2">
          {MARKETPLACE_ORDER.filter((id) => d.marketplaces[id].enabled).map((id) => {
            const on = d.defaultMarketplaces.includes(id);
            return (
              <button key={id} type="button" aria-pressed={on}
                onClick={() => s.update((x) => { x.defaultMarketplaces = on ? x.defaultMarketplaces.filter((m) => m !== id) : [...x.defaultMarketplaces, id]; return x; })}
                className={clsx('h-9 rounded-lg border px-3 text-sm', on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white hover:bg-zinc-50')}>{MARKETPLACE_NAMES[id]}</button>
            );
          })}
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm"><Toggle checked={d.rememberLastMarketplaces} onChange={(v) => s.update((x) => { x.rememberLastMarketplaces = v; return x; })} label="Remember the marketplaces I used last" /> Remember the marketplaces I used last</label>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Browser</h3>
        <div className="space-y-2 text-sm" role="radiogroup" aria-label="Browser">
          {([['chrome', 'Google Chrome (recommended)'], ['chromium', 'Playwright Chromium']] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="browser-channel" checked={d.browser.channel === v} onChange={() => s.update((x) => { x.browser.channel = v; return x; })} /> {label}</label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          Close idle browser windows after
          <input className="input h-9 w-20" type="number" min={1} max={240} value={d.browser.closeIdleMinutes} aria-label="Idle minutes"
            onChange={(e) => s.update((x) => { x.browser.closeIdleMinutes = Math.min(240, Math.max(1, Number(e.target.value) || 1)); return x; })} /> minutes
        </div>
      </section>
    </div>
  );
}
