import { useEffect, useMemo, useState } from 'react';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../../shared/constants';
import { CATEGORIES, categoryPathLabel } from '../../../shared/taxonomy';
import { useCategoryMap, useSaveCategoryMap } from '../../api/hooks';
import { Modal } from '../Modal';

export function CategoryMapModal({ mp, onClose }: { mp: MarketplaceId; onClose: () => void }) {
  const { data } = useCategoryMap(mp);
  const save = useSaveCategoryMap();
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setMap(data.map); }, [data]);
  const rows = useMemo(() => CATEGORIES.filter((c) => c.selectable).map((c) => ({ id: c.id, label: categoryPathLabel(c.id) })), []);
  return (
    <Modal title={`${MARKETPLACE_NAMES[mp]} category mapping`} onClose={onClose} wide
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ mp, map }, { onSuccess: onClose })}>Save</button>
      </>}>
      <p className="mb-3 text-sm text-zinc-600">Leave “Your mapping” empty to use the built-in mapping. Use the format <span className="font-mono">Men &gt; Shoes &gt; Sneakers</span>.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1 pr-2">Canonical path</th><th className="pr-2">Built-in mapping</th><th>Your mapping</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-100">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="pr-2 text-zinc-400">{data?.builtIn[r.id] ?? '—'}</td>
              <td><input className="input h-8 text-xs" value={map[r.id] ?? ''} aria-label={`Mapping for ${r.label}`} onChange={(e) => setMap((m) => ({ ...m, [r.id]: e.target.value }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
