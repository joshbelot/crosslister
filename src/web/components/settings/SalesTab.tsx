import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { useRunStatusChecks } from '../../api/hooks';
import { timeAgo } from '../../lib/format';
import { Toggle } from './Toggle';
import type { SettingsDraft } from './useSettingsDraft';

export function SalesTab({ s }: { s: SettingsDraft }) {
  const d = s.draft!;
  const last = useQuery({ queryKey: ['kv', 'browser_last_poll'], queryFn: () => api.get<{ value: number | null }>('/api/settings/kv/browser_last_poll') });
  const check = useRunStatusChecks();
  const lastText = last.data?.value ? timeAgo(new Date(last.data.value).toISOString()) : 'never';

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={d.statusChecks.browserPollingEnabled} label="Watch my marketplaces for sales"
            onChange={(v) => s.update((x) => { x.statusChecks.browserPollingEnabled = v; return x; })} /> Watch my marketplaces for sales
        </label>
        <p className="help">While Crosslister is running, it looks at your live Mercari, Poshmark, Depop and Grailed listings in a background tab to see whether they sold. eBay is checked through its API (see the eBay tab).</p>
        <div className="mt-3 w-56">
          <label className="label" htmlFor="browser-interval">Check every N minutes</label>
          <input id="browser-interval" type="number" min={30} max={1440} className="input" disabled={!d.statusChecks.browserPollingEnabled} value={d.statusChecks.browserIntervalMinutes}
            onChange={(ev) => s.update((x) => { x.statusChecks.browserIntervalMinutes = Math.min(1440, Math.max(30, Math.round(Number(ev.target.value)) || 60)); return x; })} />
        </div>
        <p className="mt-3 text-sm text-zinc-600"><b>Last check:</b> {lastText}</p>
        <button className="btn btn-secondary mt-2" disabled={check.isPending}
          onClick={() => check.mutate(undefined, { onSuccess: (r) => toast.success(`Checking ${r.count} listing${r.count === 1 ? '' : 's'}`) })}>Check now</button>
      </section>
      <section className="card p-4">
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={d.statusChecks.autoDelistOnSale} label="When an item sells, remove it from the other marketplaces automatically"
            onChange={(v) => s.update((x) => { x.statusChecks.autoDelistOnSale = v; return x; })} /> When an item sells, remove it from the other marketplaces automatically
        </label>
        <p className="help">The sale is recorded on the Sold page. For marketplaces where you click the final button yourself, you'll get a card in Activity to confirm each removal. Turn on “Click the final Publish button for me” for a marketplace (Settings → Marketplaces) to let the app remove it without asking.</p>
      </section>
    </div>
  );
}
