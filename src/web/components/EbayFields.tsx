/** eBay category/aspect editors — implemented in M23. Until then eBay is registered as a manual adapter and exposes no such fields. */
export function EbayCategoryField(_p: { data: Record<string, unknown>; onCommit: (v: unknown) => void }) {
  return <p className="help">Available once eBay is connected.</p>;
}
export function EbayAspectsField(_p: { data: Record<string, unknown>; value: unknown; onCommit: (v: unknown) => void; listingId: string }) {
  return <p className="help">Available once eBay is connected.</p>;
}
