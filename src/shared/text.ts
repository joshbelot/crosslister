/** lowercase, NFKD, strip diacritics, replace non-alphanumerics with space, collapse spaces, trim. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Truncate to max chars at the last word boundary ≤ max; never cut mid-word unless a single word exceeds max; no ellipsis. */
export function truncateAtWord(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  if (/\s/.test(t.charAt(max))) return t.slice(0, max).trimEnd();
  const head = t.slice(0, max);
  const idx = head.search(/\s\S*$/);
  if (idx <= 0) return head;
  return head.slice(0, idx).trimEnd();
}

export function tokenSet(s: string): Set<string> {
  return new Set(normalizeText(s).split(' ').filter((t) => t.length > 1));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
