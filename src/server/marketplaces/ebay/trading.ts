import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../services/logger';
import { adapterError, AdapterError } from '../adapterError';
import { ebayHosts, getUserAccessToken } from './auth';

export class EbayTradingError extends AdapterError {
  constructor(userMessage: string, detail: string, public codes: string[]) {
    super('API_ERROR', userMessage, detail);
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['Errors', 'PictureURL', 'NameValueList', 'Value', 'Item', 'Fee'].includes(name),
});

interface TradingError { SeverityCode?: string; ErrorCode?: string | number; ShortMessage?: string; LongMessage?: string }

/**
 * One Trading API call. `innerXml` goes inside `<{callName}Request>`; pass `formData` (with an `XML Payload` part) for picture uploads.
 * Returns the `<{callName}Response>` object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tradingCall<T = any>(callName: string, innerXml: string, opts: { formData?: FormData } = {}): Promise<T> {
  const token = await getUserAccessToken();
  const headers: Record<string, string> = {
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-SITEID': '0',
    'X-EBAY-API-COMPATIBILITY-LEVEL': '1349',
    'X-EBAY-API-IAF-TOKEN': token,
  };
  if (!opts.formData) headers['Content-Type'] = 'text/xml';
  const xml = requestXml(callName, innerXml);
  let body: BodyInit;
  if (opts.formData) { body = opts.formData; } else { body = xml; }
  const res = await fetch(ebayHosts().trading, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok && !text.includes('<Ack>')) throw adapterError('API_ERROR', 'eBay', { detail: `HTTP ${res.status}` });
  const parsed = parser.parse(text) as Record<string, T & { Ack?: string; Errors?: TradingError[] }>;
  const response = parsed[`${callName}Response`];
  if (!response) throw adapterError('API_ERROR', 'eBay', { detail: 'Unexpected response from eBay.' });
  const errors = response.Errors ?? [];
  const hard = errors.filter((e) => e.SeverityCode === 'Error');
  for (const w of errors.filter((e) => e.SeverityCode === 'Warning')) logger.warn('EBAY', `${callName}: ${w.LongMessage ?? w.ShortMessage ?? 'warning'}`);
  if (response.Ack === 'Failure' || (response.Ack === 'PartialFailure' && hard.length > 0)) {
    const detail = (hard.length ? hard : errors).map((e) => e.LongMessage ?? e.ShortMessage ?? 'Unknown error').join(' ');
    throw new EbayTradingError(`eBay returned an error: ${detail}`, detail, (hard.length ? hard : errors).map((e) => String(e.ErrorCode ?? '')));
  }
  return response as T;
}

export function requestXml(callName: string, innerXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${innerXml}<ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel></${callName}Request>`;
}
