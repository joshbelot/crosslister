/** "$65", "65", "65.5", "1,200.00", " 65.00 " → cents. Returns null for empty or invalid. Rejects negatives and >2 decimals. */
export function parsePriceToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  return (Number(whole || '0') * 100) + Number(frac.padEnd(2, '0') || '0');
}

/** 6500 → "$65.00"; null → "" */
export function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 6500 → "$65", 6550 → "$65.50" */
export function formatCentsShort(cents: number | null): string {
  if (cents === null || cents === undefined) return '';
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString('en-US')}`
    : formatCents(cents);
}

/** Apply percent adjustment and round to whole dollars: applyPriceAdjust(6500, 10) → 7200 (71.5 → round half up → 72). 0% returns input unchanged. */
export function applyPriceAdjust(cents: number, percent: number): number {
  if (!percent) return cents;
  const dollars = (cents * (1 + percent / 100)) / 100;
  return Math.round(dollars + 1e-9) * 100;
}
