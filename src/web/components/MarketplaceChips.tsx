import { Link } from 'react-router';
import clsx from 'clsx';
import { MARKETPLACE_ORDER, type MarketplaceId } from '../../shared/constants';
import { useMarketplaces } from '../api/hooks';

const KIND_TAG = { api: 'API', browser: 'Assisted', manual: 'Manual' } as const;

export function MarketplaceChips({ selected, onChange }: { selected: MarketplaceId[]; onChange: (ids: MarketplaceId[]) => void }) {
  const { data } = useMarketplaces();
  const infos = (data ?? []).filter((m) => m.prefs.enabled).sort((a, b) => MARKETPLACE_ORDER.indexOf(a.id) - MARKETPLACE_ORDER.indexOf(b.id));
  const toggle = (id: MarketplaceId) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cross-list to">
        {infos.map((m) => {
          const on = selected.includes(m.id);
          const dot = m.kind === 'manual' ? null : m.connection.status === 'connected' ? 'bg-green-500' : m.connection.status === 'unknown' ? 'bg-amber-400' : 'bg-red-500';
          return (
            <button key={m.id} type="button" aria-pressed={on} onClick={() => toggle(m.id)}
              className={clsx('flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium', on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50')}>
              {dot && <span className={clsx('h-2 w-2 rounded-full', dot)} />}
              {m.name}
              <span className={clsx('rounded px-1 text-[10px] uppercase tracking-wide', on ? 'bg-indigo-500 text-indigo-100' : 'bg-zinc-100 text-zinc-500')}>{KIND_TAG[m.kind]}</span>
            </button>
          );
        })}
        <Link to="/settings?tab=marketplaces" className="text-sm text-indigo-600 hover:underline">Manage</Link>
      </div>
      {selected.includes('facebook') && <p className="help">Facebook: you'll always click Publish yourself.</p>}
    </div>
  );
}
