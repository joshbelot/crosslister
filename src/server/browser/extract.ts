import { parse } from 'node-html-parser';
import type { Page } from 'playwright';
import { parsePriceToCents } from '../../shared/money';

export interface ExtractedProduct {
  title?: string; description?: string; priceCents?: number; currency?: string; images: string[];
  brand?: string; condition?: string; color?: string; size?: string; category?: string[];
  availability?: 'active' | 'sold' | 'ended';
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
};
const firstOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export function mapAvailability(raw: string | undefined): ExtractedProduct['availability'] {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (/soldout|outofstock|out of stock|\bsold\b/.test(t)) return 'sold';
  if (/discontinued/.test(t)) return 'ended';
  if (/instock|in stock|limitedavailability/.test(t)) return 'active';
  return undefined;
}

function mapCondition(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (t.includes('refurbished')) return 'Refurbished';
  if (t.includes('damaged')) return 'Damaged';
  if (t.includes('used')) return 'Used';
  if (/\bnew|newcondition/.test(t)) return 'New';
  return raw;
}

function imageUrls(v: unknown): string[] {
  const items = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return items.flatMap((i) => (typeof i === 'string' ? [i] : i && typeof i === 'object' && typeof (i as Json).url === 'string' ? [(i as Json).url as string] : []));
}

function flatten(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === 'object') {
    out.push(node as Json);
    if ('@graph' in (node as Json)) flatten((node as Json)['@graph'], out);
  }
  return out;
}

const isProduct = (o: Json): boolean => {
  const t = o['@type'];
  return Array.isArray(t) ? t.includes('Product') : t === 'Product';
};

function fromJsonLd(root: ReturnType<typeof parse>): ExtractedProduct {
  const out: ExtractedProduct = { images: [] };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try { data = JSON.parse(s.textContent); } catch { continue; }
    const p = flatten(data).find(isProduct);
    if (!p) continue;
    const offer = firstOf(p.offers) as Json | undefined;
    const brand = p.brand && typeof p.brand === 'object' ? str((p.brand as Json).name) : str(p.brand);
    const price = str(offer?.price) ?? str(offer?.lowPrice);
    const cat = str(p.category);
    return {
      title: str(p.name), description: str(p.description), images: imageUrls(p.image), brand,
      ...(price ? (() => { const c = parsePriceToCents(price); return c !== null ? { priceCents: c } : {}; })() : {}),
      currency: str(offer?.priceCurrency),
      availability: mapAvailability(str(offer?.availability)),
      condition: mapCondition(str(p.itemCondition) ?? str(offer?.itemCondition)),
      color: str(p.color), size: str(p.size),
      ...(cat ? { category: cat.split(/\s*[>/]\s*/).map((c) => c.trim()).filter(Boolean) } : {}),
    };
  }
  return out;
}

function fromMeta(root: ReturnType<typeof parse>): ExtractedProduct {
  const metas = root.querySelectorAll('meta');
  const all = (name: string) => metas.filter((m) => (m.getAttribute('property') ?? m.getAttribute('name')) === name).map((m) => m.getAttribute('content')?.trim() ?? '').filter(Boolean);
  const one = (name: string) => all(name)[0];
  const price = one('product:price:amount');
  const cents = price ? parsePriceToCents(price) : null;
  return {
    title: one('og:title'), description: one('og:description'), images: all('og:image'),
    ...(cents !== null ? { priceCents: cents } : {}),
    currency: one('product:price:currency'), brand: one('product:brand'), condition: mapCondition(one('product:condition')),
    availability: mapAvailability(one('product:availability')),
  };
}

const keyOf = (u: string) => u.split('?')[0]!.split('#')[0]!;

/** Merge in priority order: earlier sources win per field; images are unioned and de-duplicated without their query string. */
export function mergeExtracted(...sources: Array<Partial<ExtractedProduct>>): ExtractedProduct {
  const out: ExtractedProduct = { images: [] };
  const seen = new Set<string>();
  const o = out as unknown as Record<string, unknown>;
  for (const s of sources) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'images') continue;
      if (v !== undefined && v !== '' && o[k] === undefined) o[k] = v;
    }
    for (const img of s.images ?? []) {
      const k = keyOf(img);
      if (!seen.has(k)) { seen.add(k); out.images.push(img); }
    }
  }
  return out;
}

/** Pure extraction from page source: JSON-LD first, then OpenGraph/product meta tags. */
export function extractFromHtml(html: string, baseUrl?: string): ExtractedProduct {
  const root = parse(html);
  const merged = mergeExtracted(fromJsonLd(root), fromMeta(root));
  if (baseUrl) {
    merged.images = merged.images.flatMap((u) => { try { return [new URL(u, baseUrl).toString()]; } catch { return []; } });
  }
  return merged;
}

export async function extractProduct(page: Page, extra?: (page: Page) => Promise<Partial<ExtractedProduct>>): Promise<ExtractedProduct> {
  const base = extractFromHtml(await page.content(), page.url());
  if (!extra) return base;
  let more: Partial<ExtractedProduct> = {};
  try { more = await extra(page); } catch { /* extras are best-effort */ }
  return mergeExtracted(base, more);
}
