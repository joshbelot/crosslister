import { useSearchParams } from 'react-router';
import clsx from 'clsx';
import { AboutTab } from '../components/settings/AboutTab';
import { BackupTab } from '../components/settings/BackupTab';
import { GeneralTab } from '../components/settings/GeneralTab';
import { MarketplacesTab } from '../components/settings/MarketplacesTab';
import { useSettingsDraft } from '../components/settings/useSettingsDraft';
import { EbayTab } from '../components/settings/EbayTab';
import { AiTab } from '../components/settings/AiTab';

const TABS = [
  ['general', 'General'], ['marketplaces', 'Marketplaces'], ['ebay', 'eBay'], ['ai', 'AI'], ['backup', 'Backup & Export'], ['about', 'About'],
] as const;
type Tab = (typeof TABS)[number][0];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.some(([k]) => k === raw) ? (raw as Tab) : 'general';
  const s = useSettingsDraft();
  const needsSave = tab !== 'backup' && tab !== 'about';

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-6 py-6">
      <nav className="w-48 shrink-0" aria-label="Settings sections">
        <ul className="space-y-1">
          {TABS.map(([k, label]) => (
            <li key={k}>
              <button className={clsx('w-full rounded-lg px-3 py-2 text-left text-sm font-medium', tab === k ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-600 hover:bg-zinc-100')}
                onClick={() => setParams({ tab: k }, { replace: true })}>{label}</button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 pb-24">
        <h1 className="mb-5 text-xl font-semibold">{TABS.find(([k]) => k === tab)![1]}</h1>
        {!s.draft ? <p className="text-sm text-zinc-500">Loading…</p> : (
          <>
            {tab === 'general' && <GeneralTab s={s} />}
            {tab === 'marketplaces' && <MarketplacesTab s={s} />}
            {tab === 'ebay' && <EbayTab s={s} />}
            {tab === 'ai' && <AiTab s={s} />}
            {tab === 'backup' && <BackupTab />}
            {tab === 'about' && <AboutTab />}
          </>
        )}
      </div>
      {needsSave && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl justify-end px-6 py-3">
            <button className="btn btn-primary" disabled={!s.dirty || s.saving} onClick={s.save}>{s.saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
