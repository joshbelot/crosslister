// Leaf module (imports nothing from the app) so any adapter file can use the error types without import cycles.
export type AdapterErrorCode =
  | 'LOGIN_REQUIRED' | 'NOT_CONNECTED' | 'NOT_CONFIGURED' | 'ELEMENT_NOT_FOUND' | 'OPTION_NOT_FOUND' | 'FILL_FAILED'
  | 'CATEGORY_NOT_SELECTABLE' | 'UPLOAD_FAILED' | 'PUBLISH_NOT_CONFIRMED' | 'BROWSER_CLOSED' | 'NETWORK' | 'TIMEOUT'
  | 'API_ERROR' | 'DAILY_LIMIT' | 'CANCELLED' | 'APP_RESTARTED' | 'UNKNOWN';

export class AdapterError extends Error {
  /** `named` is false when the thrower did not know the marketplace name; toAdapterError() then rebuilds the message. */
  constructor(public code: AdapterErrorCode, public userMessage: string, public detail?: string, public params?: ErrorParams, public named = true) {
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

/** `marketplaceName === null` for low-level helpers that don't know it; the job runner fills it in later. */
export function adapterError(code: AdapterErrorCode, marketplaceName: string | null, p: ErrorParams = {}): AdapterError {
  return new AdapterError(code, errorMessage(code, marketplaceName ?? 'the marketplace', p), p.detail ?? p.what ?? p.value, p, marketplaceName !== null);
}

export function toAdapterError(err: unknown, marketplaceName: string): AdapterError {
  if (err instanceof AdapterError) return err.named || !err.params ? err : adapterError(err.code, marketplaceName, err.params);
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

