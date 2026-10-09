import { Download } from 'lucide-react';
import { Link } from 'react-router';
import { useBackups } from '../../api/hooks';
import { formatDate } from '../../lib/format';
import { useQueryClient } from '@tanstack/react-query';

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function BackupTab() {
  const backups = useBackups();
  const qc = useQueryClient();
  const download = (url: string, refresh = false) => {
    window.location.href = url;
    if (refresh) setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 2500);
  };
  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h3 className="mb-3 font-semibold">Export</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={() => download('/api/export/json')}><Download size={15} /> Export inventory (JSON)</button>
          <button className="btn btn-secondary" onClick={() => download('/api/export/csv')}><Download size={15} /> Export inventory (CSV)</button>
          <button className="btn btn-primary" onClick={() => download('/api/export/backup', true)}><Download size={15} /> Create full backup (ZIP)</button>
        </div>
        <p className="help">The full backup contains your database and original photos. It never includes passwords, browser sessions or tokens.</p>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Saved backups</h3>
        {(backups.data ?? []).length === 0 ? <p className="text-sm text-zinc-500">No backups yet.</p> : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {backups.data!.map((b) => (
              <li key={b.name} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 font-mono text-xs">{b.name}</span>
                <span className="text-zinc-500">{mb(b.bytes)}</span>
                <span className="w-44 text-zinc-500">{formatDate(b.createdAt)}</span>
                <a className="btn btn-secondary btn-sm" href={`/api/export/backups/${b.name}`}>Download</a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Restore</h3>
        <p className="text-sm text-zinc-700">To restore a backup: quit Crosslister, move your current data folder aside, create a new data folder, unzip the backup into it, and start Crosslister. Or merge an export into your current inventory:</p>
        <Link to="/import?source=backup" className="btn btn-secondary mt-3">Restore from export JSON…</Link>
      </section>
    </div>
  );
}
