import fs from 'node:fs';
import { parse } from 'node-html-parser';
import { parsePriceToCents } from '../../../shared/money';
import type { DiscoveredItem, ImportedListing, MarketplaceImporter } from '../../importers/types';
import type { RemoteStatus } from '../types';
import { ebayHosts } from './auth';
import { tradingCall } from './trading';
import { escapeXml } from './xml';

// The XML parser returns text, numbers, `{ '#text', '@_currencyID' }` objects or arrays depending on the shape.
type Node = string | number | { '#text'?: string | number } | undefined;
const text = (n: Node): string => (n === undefined || n === null ? '' : typeof n === 'object' ? String(n['#text'] ?? '') : String(n));
const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

export function htmlToText(html: string): string {
  const root = parse(html);
  root.querySelectorAll('script,style').forEach((e) => e.remove());
  return root.structuredText.replace(/\n{3,}/g, '\n\n').trim();
}

interface ActiveItem { ItemID?: Node; Title?: Node; PictureDetails?: { GalleryURL?: Node } }
interface ItemSpecific { Name?: Node; Value?: Node[] | Node }
interface FullItem {
  ItemID?: Node; Title?: Node; Description?: Node; StartPrice?: Node; ConditionID?: Node; SKU?: Node; Quantity?: Node;
  PrimaryCategory?: { CategoryName?: Node };
  PictureDetails?: { PictureURL?: Node[] };
  ItemSpecifics?: { NameValueList?: ItemSpecific[] };
  SellingStatus?: { ListingStatus?: Node; QuantitySold?: Node };
}

function specific(item: FullItem, ...names: string[]): string {
  const wanted = names.map((n) => n.toLowerCase());
  for (const nv of item.ItemSpecifics?.NameValueList ?? []) {
    if (wanted.includes(text(nv.Name).toLowerCase())) {
      const v = Array.isArray(nv.Value) ? nv.Value : [nv.Value];
      return v.map(text).filter(Boolean).join(', ');
    }
  }
  return '';
}

export function ebayStatus(item: FullItem): RemoteStatus {
  const st = item.SellingStatus;
  const s = text(st?.ListingStatus);
  if (s === 'Active') return 'active';
  if ((s === 'Completed' || s === 'Ended') && Number(text(st?.QuantitySold) || 0) > 0) return 'sold';
  return s ? 'ended' : 'unknown';
}

export const ebayImporter: MarketplaceImporter = {
  methods: ['api'],

  async scan(ctx) {
    const out: DiscoveredItem[] = [];
    let page = 1;
    let pages = 1;
    do {
      ctx.throwIfCancelled();
      type Res = { ActiveList?: { ItemArray?: { Item?: ActiveItem[] }; PaginationResult?: { TotalNumberOfPages?: Node } } };
      const res = await tradingCall<Res>('GetMyeBaySelling',
        `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`);
      pages = Number(text(res.ActiveList?.PaginationResult?.TotalNumberOfPages)) || 1;
      for (const it of res.ActiveList?.ItemArray?.Item ?? []) {
        const id = text(it.ItemID);
        if (!id) continue;
        out.push({ remoteId: id, url: ebayHosts().itemPage(id), title: text(it.Title), thumbUrl: text(it.PictureDetails?.GalleryURL) || null });
      }
      ctx.progress(`Found ${out.length} listings…`);
      page++;
    } while (page <= pages);
    return out;
  },

  async fetch(_ctx, item) {
    if (!item.remoteId) throw new Error('This eBay listing has no item number.');
    const res = await tradingCall<{ Item?: FullItem | FullItem[] }>('GetItem',
      `<ItemID>${escapeXml(item.remoteId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`);
    const it = first(res.Item);
    if (!it) throw new Error('eBay did not return that listing.');
    const sold = Number(text(it.SellingStatus?.QuantitySold) || 0);
    const sku = text(it.SKU);
    const imp: ImportedListing = {
      remoteId: item.remoteId,
      url: ebayHosts().itemPage(item.remoteId),
      title: text(it.Title),
      description: htmlToText(text(it.Description)),
      priceCents: parsePriceToCents(text(it.StartPrice)),
      conditionText: text(it.ConditionID) || null,
      categoryTexts: text(it.PrimaryCategory?.CategoryName).split(':').map((s) => s.trim()).filter(Boolean),
      brand: specific(it, 'Brand'),
      size: specific(it, 'Size', 'US Shoe Size'),
      colorTexts: specific(it, 'Color').split(',').map((s) => s.trim()).filter(Boolean),
      photoUrls: (it.PictureDetails?.PictureURL ?? []).map(text).filter(Boolean),
      status: ebayStatus(it),
      quantity: Math.max(1, (Number(text(it.Quantity)) || 1) - sold),
      extra: sku ? { SKU: sku } : {},
    };
    return imp;
  },

  async downloadPhoto(_ctx, url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photo download failed (${res.status}).`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  },
};
