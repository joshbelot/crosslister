import { useState } from 'react';
import { MARKETPLACE_NAMES } from '../../shared/constants';
import { useDismissSale, useListing, useListings } from '../api/hooks';
import { MarkSoldModal } from './MarkSoldModal';

function ReviewSale({ id, onClose }: { id: string; onClose: () => void }) {
  const l = useListing(id).data;
  return l ? <MarkSoldModal listing={l} onClose={onClose} /> : null;
}

/** Sale-detected banner (04 §9.4): one row per listing where a status check found a sale. */
export function SaleBanner() {
  const items = (useListings({ filter: 'needs_attention', q: '', sort: 'updated_desc' }).data?.items ?? [])
    .filter((l) => l.saleDetectedMarketplaceId).slice(0, 3);
  const dismiss = useDismissSale();
  const [reviewId, setReviewId] = useState<string | null>(null);
  if (items.length === 0 && !reviewId) return null;
  return (
    <div className="space-y-1 px-6 pt-3">
      {items.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{l.title} sold on {MARKETPLACE_NAMES[l.saleDetectedMarketplaceId!]}. Remove it from the other marketplaces?</span>
          <span className="flex shrink-0 gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => setReviewId(l.id)}>Review</button>
            <button className="btn btn-secondary btn-sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(l.id)}>Dismiss</button>
          </span>
        </div>
      ))}
      {reviewId && <ReviewSale id={reviewId} onClose={() => setReviewId(null)} />}
    </div>
  );
}
