import { BadgeDollarSign, Check, Circle, Loader2, Minus, X } from 'lucide-react';
import clsx from 'clsx';
import { MARKETPLACE_SHORT, type MarketplaceId, type MarketplaceListingStatus } from '../../shared/constants';

const STYLE: Record<MarketplaceListingStatus, string> = {
  active: 'text-green-600', in_progress: 'text-blue-600', error: 'text-red-600',
  sold: 'text-violet-600', ended: 'text-zinc-400', not_listed: 'text-zinc-400',
};
const ICON: Record<MarketplaceListingStatus, typeof Check> = {
  active: Check, in_progress: Loader2, error: X, sold: BadgeDollarSign, ended: Minus, not_listed: Circle,
};

export function MarketplaceBadge({ marketplaceId, status, url }: { marketplaceId: MarketplaceId; status: MarketplaceListingStatus; url?: string | null }) {
  const Icon = ICON[status];
  const inner = (
    <>
      <Icon size={12} className={clsx(status === 'in_progress' && 'animate-spin')} />
      {MARKETPLACE_SHORT[marketplaceId]}
    </>
  );
  const cls = clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium', STYLE[status],
    status === 'not_listed' ? 'border-zinc-300' : 'border-transparent bg-zinc-50');
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={clsx(cls, 'hover:underline')} title={`${status.replace('_', ' ')} — open`}
        onClick={(e) => e.stopPropagation()}>{inner}</a>
    );
  }
  return <span className={cls} title={status.replace('_', ' ')}>{inner}</span>;
}
