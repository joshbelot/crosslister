import { FolderOpen } from 'lucide-react';
import { api } from '../../api/client';
import { useHealth } from '../../api/hooks';
import { toast } from 'sonner';

export function AboutTab() {
  const { data } = useHealth();
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  const rows: Array<[string, string, 'data' | 'profiles' | 'logs' | null]> = [
    ['Version', data.version, null], ['Platform', data.platform, null],
    ['Data folder', data.dataDir, 'data'], ['Browser profiles folder', data.profilesDir, 'profiles'], ['Logs folder', data.logsDir, 'logs'],
  ];
  const open = async (which: 'data' | 'profiles' | 'logs') => {
    const r = await api.post<{ path: string }>('/api/system/open-folder', { which });
    if (data.platform !== 'darwin') toast.info(r.path);
  };
  return (
    <dl className="max-w-2xl divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
      {rows.map(([label, value, which]) => (
        <div key={label} className="flex items-center gap-3 px-4 py-3">
          <dt className="w-44 text-zinc-500">{label}</dt>
          <dd className="min-w-0 flex-1 break-all font-mono text-xs">{value}</dd>
          {which && <button className="btn btn-secondary btn-sm" onClick={() => void open(which)}><FolderOpen size={13} /> {data.platform === 'darwin' ? 'Open in Finder' : 'Show path'}</button>}
        </div>
      ))}
    </dl>
  );
}
