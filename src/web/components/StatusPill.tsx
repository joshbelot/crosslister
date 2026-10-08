import clsx from 'clsx';
import type { ListingStatus } from '../../shared/constants';

const STYLES: Record<ListingStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  ready: 'bg-sky-100 text-sky-700',
  partially_listed: 'bg-amber-100 text-amber-800',
  listed: 'bg-green-100 text-green-700',
  sold: 'bg-violet-100 text-violet-700',
  archived: 'bg-zinc-100 text-zinc-400',
};
const LABELS: Record<ListingStatus, string> = {
  draft: 'Draft', ready: 'Ready', partially_listed: 'Partially listed', listed: 'Listed', sold: 'Sold', archived: 'Archived',
};

export function StatusPill({ status }: { status: ListingStatus }) {
  return <span className={clsx('pill', STYLES[status])}>{LABELS[status]}</span>;
}
