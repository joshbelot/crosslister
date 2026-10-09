import { Activity, Loader2, Plus } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import clsx from 'clsx';
import { useEventStream } from '../api/events';
import { useJobs } from '../api/hooks';
import { useHotkeys } from '../lib/keyboard';
import { setUi, useUi } from '../lib/ui';
import { ActivityDrawer } from './ActivityDrawer';
import { SaleBanner } from './SaleBanner';
import { ShortcutHelp } from './ShortcutHelp';

const NAV = [{ to: '/', label: 'Inventory', end: true }, { to: '/import', label: 'Import' }, { to: '/settings', label: 'Settings' }, { to: '/logs', label: 'Logs' }];

export function Layout() {
  const { connected } = useEventStream();
  const navigate = useNavigate();
  const ui = useUi();
  const jobs = useJobs({ active: true });
  const needsUser = (jobs.data ?? []).filter((j) => j.state === 'NEEDS_USER').length;
  const running = (jobs.data ?? []).some((j) => j.state === 'IN_PROGRESS');

  useHotkeys({
    n: () => navigate('/listings/new/edit'),
    a: () => setUi({ drawerOpen: !ui.drawerOpen }),
    '?': () => setUi({ helpOpen: true }),
    'g i': () => navigate('/'),
    'g s': () => navigate('/settings'),
    'g l': () => navigate('/logs'),
  });

  return (
    <div className="min-h-screen min-w-[1024px]">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-6 border-b border-zinc-200 bg-white px-6">
        <NavLink to="/" className="text-lg font-semibold tracking-tight text-indigo-700">Crosslister</NavLink>
        <nav className="flex gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => clsx('rounded-md px-3 py-1.5 text-sm font-medium', isActive ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {!connected && <span className="pill bg-amber-100 text-amber-800">Reconnecting…</span>}
          <button className="btn btn-secondary relative" onClick={() => setUi({ drawerOpen: !ui.drawerOpen })} aria-label="Activity">
            <Activity size={16} /> Activity
            {running && <Loader2 size={12} className="absolute -right-1 -top-1 animate-spin text-indigo-600" />}
            {needsUser > 0 && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">{needsUser}</span>}
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/listings/new/edit')}>
            <Plus size={16} /> New Listing <span className="kbd !border-indigo-400 !bg-indigo-500 !text-indigo-100">N</span>
          </button>
        </div>
      </header>
      <SaleBanner />
      <main><Outlet /></main>
      {ui.drawerOpen && <ActivityDrawer onClose={() => setUi({ drawerOpen: false })} />}
      {ui.helpOpen && <ShortcutHelp onClose={() => setUi({ helpOpen: false })} />}
    </div>
  );
}
