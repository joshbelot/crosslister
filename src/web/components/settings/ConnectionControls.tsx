import type { MarketplaceInfo } from '../../../shared/types';

/** Connect / disconnect controls — completed in M20. */
export function ConnectionControls({ info }: { info: MarketplaceInfo }) {
  if (info.kind === 'manual') return <p className="mt-2 text-sm text-zinc-500">Manual — nothing to connect.</p>;
  return null;
}
