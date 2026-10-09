import { CheckCircle2, CircleHelp, LogOut } from 'lucide-react';
import type { MarketplaceInfo } from '../../../shared/types';
import { useConnect, useDisconnect } from '../../api/hooks';
import { timeAgo } from '../../lib/format';
import { setUi } from '../../lib/ui';

const LABEL = { unknown: 'Not checked yet', connected: 'Connected', logged_out: 'Logged out', not_configured: 'Not set up' } as const;

export function ConnectionControls({ info }: { info: MarketplaceInfo }) {
  const connect = useConnect();
  const disconnect = useDisconnect();
  if (info.kind === 'manual') return <p className="mt-2 text-sm text-zinc-500">Manual — nothing to connect.</p>;
  const c = info.connection;
  const connected = c.status === 'connected';
  return (
    <div className="mt-3 flex items-center gap-3 text-sm" data-testid={`connection-${info.id}`}>
      {connected ? <CheckCircle2 size={16} className="text-green-600" /> : <CircleHelp size={16} className="text-amber-500" />}
      <span className={connected ? 'text-green-700' : 'text-zinc-700'}>
        {LABEL[c.status]}{c.accountName ? ` as ${c.accountName}` : ''}
      </span>
      {c.checkedAt && <span className="text-zinc-400">checked {timeAgo(c.checkedAt)}</span>}
      {c.message && !connected && <span className="text-zinc-500">{c.message}</span>}
      <div className="ml-auto flex gap-2">
        <button className="btn btn-secondary btn-sm" disabled={connect.isPending}
          onClick={() => connect.mutate(info.id, { onSuccess: () => setUi({ drawerOpen: true }) })}>
          {connected ? 'Log in again' : 'Connect'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={disconnect.isPending || c.status === 'logged_out'}
          onClick={() => { if (window.confirm(`This deletes the saved browser session for ${info.name}. You'll need to log in again.`)) disconnect.mutate(info.id); }}>
          <LogOut size={13} /> Disconnect
        </button>
      </div>
    </div>
  );
}
