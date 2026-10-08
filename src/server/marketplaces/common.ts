import type { CopyField, MarketplaceListing } from '../../shared/types';
import { COLORS } from '../../shared/colors';
import { formatCents } from '../../shared/money';
import type { EffectiveListing } from './types';

export type AdapterErrorCode =
  | 'LOGIN_REQUIRED' | 'NOT_CONNECTED' | 'NOT_CONFIGURED' | 'ELEMENT_NOT_FOUND' | 'OPTION_NOT_FOUND' | 'FILL_FAILED'
  | 'CATEGORY_NOT_SELECTABLE' | 'UPLOAD_FAILED' | 'PUBLISH_NOT_CONFIRMED' | 'BROWSER_CLOSED' | 'NETWORK' | 'TIMEOUT'
  | 'API_ERROR' | 'DAILY_LIMIT' | 'CANCELLED' | 'APP_RESTARTED' | 'UNKNOWN';

export class AdapterError extends Error {
  constructor(public code: AdapterErrorCode, public userMessage: string, public detail?: string) {
    super(userMessage);
  }
}

export interface ErrorParams { what?: string; value?: string; detail?: string; limit?: number | string }

/** User-facing message catalog (05 §6.5). `{N}` is the marketplace name. */
export function errorMessage(code: AdapterErrorCode, N: string, p: ErrorParams = {}): string {
  switch (code) {
    case 'LOGIN_REQUIRED': return `You're not logged in to ${N}.`;
    case 'NOT_CONNECTED': return `${N} isn't connected yet. Open Settings → Marketplaces and click Connect.`;
    case 'NOT_CONFIGURED': return `${N} isn't set up yet. See Settings → Marketplaces → ${N}.`;
    case 'ELEMENT_NOT_FOUND': return `${N}'s page didn't look the way the app expected (couldn't find “${p.what ?? 'a control'}”). ${N} may have changed its website.`;
    case 'OPTION_NOT_FOUND': return `Couldn't find the option “${p.value ?? ''}” for ${p.what ?? 'a field'} on ${N}.`;
    case 'FILL_FAILED': return `Couldn't type into “${p.what ?? 'a field'}” on ${N}.`;
    case 'CATEGORY_NOT_SELECTABLE': return 'The category could not be selected automatically.';
    case 'UPLOAD_FAILED': return `Photos could not be uploaded to ${N}.`;
    case 'PUBLISH_NOT_CONFIRMED': return `The app couldn't confirm that the listing was published on ${N}.`;
    case 'BROWSER_CLOSED': return `The ${N} browser window was closed before the job finished.`;
    case 'NETWORK': return `Couldn't reach ${N}. Check your internet connection.`;
    case 'TIMEOUT': return `${N} took too long to respond.`;
    case 'API_ERROR': return `${N} returned an error: ${p.detail ?? 'unknown error'}`;
    case 'DAILY_LIMIT': return `You've reached today's limit for ${N} (${p.limit ?? ''}). You can change it in Settings.`;
    case 'CANCELLED': return 'Cancelled.';
    case 'APP_RESTARTED': return `The app was restarted while this was running. Check ${N} to see whether it went through, then Retry or use “Mark as listed”.`;
    case 'UNKNOWN': return `Something unexpected happened with ${N}. Details were written to the log.`;
  }
}

export function adapterError(code: AdapterErrorCode, marketplaceName: string, p: ErrorParams = {}): AdapterError {
  return new AdapterError(code, errorMessage(code, marketplaceName, p), p.detail ?? p.what ?? p.value);
}

export function toAdapterError(err: unknown, marketplaceName: string): AdapterError {
  if (err instanceof AdapterError) return err;
  const e = err as { name?: string; message?: string; cause?: { code?: string } } | null;
  const msg = String(e?.message ?? err ?? '');
  if (e?.name === 'AbortError' || /\baborted\b/i.test(msg)) return adapterError('CANCELLED', marketplaceName);
  if (/Target page, context or browser has been closed|browser has been closed|Target closed/i.test(msg)) {
    return adapterError('BROWSER_CLOSED', marketplaceName);
  }
  if (e?.name === 'TimeoutError') return adapterError('TIMEOUT', marketplaceName);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/.test(msg) || /ENOTFOUND|ECONNRESET|ECONNREFUSED/.test(e?.cause?.code ?? '')) {
    return adapterError('NETWORK', marketplaceName);
  }
  const out = adapterError('UNKNOWN', marketplaceName);
  out.detail = msg;
  return out;
}

/** Fixture tests point adapters at local pages with CROSSLISTER_URL_OVERRIDES (05 §8.6). */
export function resolveUrl(mp: string, key: string, defaultUrl: string): string {
  const raw = process.env.CROSSLISTER_URL_OVERRIDES;
  if (!raw) return defaultUrl;
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    return parsed[mp]?.[key] ?? defaultUrl;
  } catch {
    return defaultUrl;
  }
}

/** Suffix host match (`www.mercari.com` matches `mercari.com`). Skipped when URL overrides are active. */
export function hostOk(url: string, hosts: string[]): boolean {
  if (process.env.CROSSLISTER_URL_OVERRIDES) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((x) => h === x || h.endsWith('.' + x));
  } catch {
    return false;
  }
}

export function lastPathSegment(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}

/** Values offered with copy buttons in "needs your attention" cards (05 §7.2 step 4). */
export function standardCopyFields(eff: EffectiveListing, mapping: Array<{ label: string; value: string }>): CopyField[] {
  const colorLabels = eff.colors.map((c) => COLORS.find((x) => x.id === c)?.label ?? c).join(', ');
  const fields: CopyField[] = [
    { label: 'Title', value: eff.title },
    { label: 'Description', value: eff.description },
    { label: 'Price', value: formatCents(eff.priceCents) },
    { label: 'Brand', value: eff.brand },
    { label: 'Size', value: eff.size },
    ...mapping,
    { label: 'Colors', value: colorLabels },
    { label: 'Tags', value: eff.tags.join(', ') },
  ];
  return fields.filter((f) => f.value.trim() !== '');
}

export type { MarketplaceListing };
