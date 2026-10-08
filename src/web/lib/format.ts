export { applyPriceAdjust, formatCents, formatCentsShort, parsePriceToCents } from '../../shared/money';
export { jaccard, normalizeText, tokenSet, truncateAtWord } from '../../shared/text';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['minute', 60], ['hour', 3600], ['day', 86400], ['month', 2592000], ['year', 31536000]];
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let div = 60;
  for (const [u, d] of units) { if (seconds >= d) { unit = u; div = d; } }
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(seconds / div), unit);
}

/** 20 oz → "1 lb 4 oz" */
export function formatWeight(oz: number | null | undefined): string {
  if (oz === null || oz === undefined) return '';
  const lb = Math.floor(oz / 16);
  const rest = Math.round((oz - lb * 16) * 10) / 10;
  return [lb ? `${lb} lb` : '', rest || !lb ? `${rest} oz` : ''].filter(Boolean).join(' ');
}
