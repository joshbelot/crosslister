import { useState } from 'react';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ListingDetail } from '../../shared/types';
import { useDeactivateAll } from '../api/hooks';
import { setUi } from '../lib/ui';
import { Modal } from './Modal';

export function DeactivateAllModal({ listing, onClose }: { listing: ListingDetail; onClose: () => void }) {
  const active = listing.marketplaces.filter((m) => m.status === 'active');
  const [checked, setChecked] = useState<Set<MarketplaceId>>(new Set(active.map((m) => m.marketplaceId)));
  const mutation = useDeactivateAll();
  return (
    <Modal title="Deactivate everywhere" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={checked.size === 0 || mutation.isPending} autoFocus
          onClick={() => mutation.mutate({ id: listing.id, marketplaceIds: [...checked] }, { onSuccess: () => { onClose(); setUi({ drawerOpen: true }); } })}>
          Remove from {checked.size} marketplace{checked.size === 1 ? '' : 's'}
        </button>
      </>}>
      <p className="mb-3 text-sm text-zinc-600">Remove this item from the selected marketplaces. The item stays in your inventory.</p>
      <div className="space-y-1.5">
        {active.map((m) => (
          <label key={m.marketplaceId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checked.has(m.marketplaceId)}
              onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(m.marketplaceId); else n.delete(m.marketplaceId); return n; })} />
            {MARKETPLACE_NAMES[m.marketplaceId]}
          </label>
        ))}
      </div>
    </Modal>
  );
}
