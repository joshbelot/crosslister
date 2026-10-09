import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { CONDITION_LABELS } from '../../../shared/constants';
import { formatCents } from '../../../shared/money';
import { categoryAncestry, departmentOf } from '../../../shared/taxonomy';
import type { MarketplaceCapabilities, MarketplaceListing, ValidationIssue } from '../../../shared/types';
import type { Db } from '../../db/client';
import { jobs, listings } from '../../db/schema';
import type { ColorId } from '../../../shared/colors';
import { sizeTypeOf } from '../../../shared/taxonomy';
import { resolveWaiter } from '../../services/jobContext';
import { getJobRow, updateJob } from '../../services/jobs';
import { getConnection } from '../../services/connectionStore';
import { logger } from '../../services/logger';
import { getSettings, setKv } from '../../services/settings';
import { adapterError } from '../adapterError';
import { getAdapterDb, hostOk } from '../common';
import type { MarketplaceAdapter } from '../types';
import { disconnect, ebayHosts, EBAY_SCOPES, buildAuthorizeUrl, exchangeCode, getUserAccessToken, hasUserToken, isConfigured, missingConfig } from './auth';
import {
  EBAY_HOSTS, EBAY_LISTING_REGEX, autoAspects, categoryQuery, hasAutoValue, mergeAspects, pickConditionId,
} from './mapping';
import { getAspects, getConditions, getPolicies, suggestCategories } from './rest';
import { ebayImporter } from './importer';
import { EbayTradingError, requestXml, tradingCall } from './trading';
import { buildItemXml, cdata, descriptionToHtml, escapeXml } from './xml';

const dataSchema = z.object({
  categoryId: z.string().regex(/^\d+$/).optional(),
  categoryName: z.string().optional(),
  categoryAuto: z.boolean().default(true),
  requiredAspects: z.array(z.string()).default([]),
  aspects: z.record(z.string(), z.array(z.string())).default({}),
  conditionId: z.number().int().optional(),
  bestOffer: z.boolean().default(false),
});
export type EbayData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'auto', update: 'auto', deactivate: 'auto', statusCheck: 'api', import: 'api', autoSubmitAllowed: true,
  maxPhotos: 24, titleMaxLength: 80, descriptionMaxLength: 500000, minPriceCents: 99, maxPriceCents: null,
  requires: ['title', 'price', 'condition', 'category'],
};

const itemUrl = (id: string) => ebayHosts().itemPage(id);

async function feeTotalCents(response: { Fees?: { Fee?: unknown[] } }): Promise<number> {
  let total = 0;
  for (const f of response.Fees?.Fee ?? []) {
    const inner = (f as { Fee?: unknown }).Fee;
    const first = Array.isArray(inner) ? inner[0] : inner;
    const n = typeof first === 'object' && first !== null ? Number((first as Record<string, unknown>)['#text']) : Number(first);
    if (Number.isFinite(n)) total += n;
  }
  return Math.round(total * 100);
}

function requireItemId(ml: MarketplaceListing): string {
  if (!ml.remoteId) throw adapterError('API_ERROR', 'eBay', { detail: 'This listing has no eBay item number.' });
  return ml.remoteId;
}

export const ebayAdapter: MarketplaceAdapter<EbayData> = {
  id: 'ebay',
  name: 'eBay',
  kind: 'api',
  capabilities,
  importer: ebayImporter,
  photoSpec: { maxPhotos: 24, maxLongEdge: 1600, quality: 90 },
  urls: { home: ebayHosts().home, sell: 'https://www.ebay.com/sl/sell' },
  dataSchema,
  dataFields: [
    { key: 'categoryId', label: 'eBay category', type: 'ebay_category' },
    { key: 'aspects', label: 'Item specifics', type: 'ebay_aspects' },
    { key: 'conditionId', label: 'eBay condition', type: 'select' },
    { key: 'bestOffer', label: 'Accept offers (Best Offer)', type: 'boolean' },
  ],

  validate(l): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const err = (field: string, message: string) => issues.push({ field, severity: 'error', message });
    if (!isConfigured()) err('data', "eBay isn't set up yet. See docs/SETUP.md → Connect eBay.");
    const db = getAdapterDb();
    if (db) {
      if (isConfigured() && getConnection(db, 'ebay')?.status !== 'connected') err('data', 'Connect eBay in Settings → Marketplaces.');
      const e = getSettings(db).ebay;
      if (!e.fulfillmentPolicyId || !e.paymentPolicyId || !e.returnPolicyId) {
        err('data', 'Choose your eBay shipping, payment and return policies in Settings → Marketplaces → eBay.');
      }
      if (!e.postalCode) err('data', 'Add your ZIP code in Settings → Marketplaces → eBay.');
    }
    if (!l.data.categoryId) err('data.categoryId', 'Choose an eBay category.');
    else if (l.data.categoryAuto) {
      issues.push({ field: 'data.categoryId', severity: 'warning', message: `eBay category chosen automatically: ${l.data.categoryName ?? l.data.categoryId}. Change it if it's wrong.` });
    }
    for (const name of l.data.requiredAspects) {
      const have = (l.data.aspects[name] ?? []).length > 0 || hasAutoValue(l, name);
      if (!have) err('data.aspects', `eBay requires “${name}” for this category.`);
    }
    return issues;
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    if (l.data.categoryName || l.data.categoryId) rows.push({ label: 'Category', value: l.data.categoryName ?? l.data.categoryId! });
    if (l.data.conditionId) rows.push({ label: 'Condition', value: `eBay condition ${l.data.conditionId}` });
    else if (l.condition) rows.push({ label: 'Condition', value: CONDITION_LABELS[l.condition] });
    const count = Object.keys(mergeAspects({}, l.data.aspects)).length;
    if (count) rows.push({ label: 'Item specifics', value: `${count} set` });
    return rows;
  },

  parseListingUrl(url) {
    if (!hostOk(url, EBAY_HOSTS)) return null;
    try {
      const m = EBAY_LISTING_REGEX.exec(new URL(url).pathname);
      return m?.[1] ? { remoteId: m[1], url: itemUrl(m[1]) } : null;
    } catch { return null; }
  },
  listingUrl: itemUrl,

  async disconnect() { await disconnect(); },

  async prepare(_db: Db, listing, ml) {
    try {
      if (!isConfigured() || !listing.categoryId) return {};
      if ((ml.data as { categoryAuto?: boolean }).categoryAuto === false) return {};
      const labels = categoryAncestry(listing.categoryId).map((c) => c.label);
      const q = categoryQuery({ categoryLabels: labels, department: departmentOf(listing.categoryId), title: listing.title });
      const [best] = await suggestCategories(q);
      if (!best) return {};
      const aspects = await getAspects(best.categoryId);
      return { categoryId: best.categoryId, categoryName: best.path, categoryAuto: true, requiredAspects: aspects.filter((a) => a.required).map((a) => a.name) };
    } catch (err) {
      logger.warn('EBAY', `Category suggestion failed: ${(err as Error).message}`);
      return {};
    }
  },

  async connect(ctx) {
    if (!isConfigured()) {
      return { status: 'not_configured', accountName: null, message: 'Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME to .env (see docs/SETUP.md).' };
    }
    const state = nanoid(24);
    updateJob(ctx.db, ctx.job.id, { input: { ...(getJobRow(ctx.db, ctx.job.id).input ?? {}), state } });
    const url = buildAuthorizeUrl(state);
    if (process.platform === 'darwin') execFile('open', [url], () => { /* ignore */ });
    const answer = await ctx.requestUser({
      reason: 'login', title: 'Connect eBay',
      instructions: 'Sign in to eBay in the tab that opened and click “Agree”. If the tab shows an error page afterwards, copy its full address from the address bar and paste it below.',
      link: { label: 'Open eBay sign-in', url }, allowUrlInput: true, primaryAction: 'Done',
    });
    let code: string | null = null;
    try {
      const u = new URL(answer.url ?? '');
      code = u.searchParams.get('code');
      const st = u.searchParams.get('state');
      if (st && st !== state) throw adapterError('API_ERROR', 'eBay', { detail: 'That sign-in belongs to a different request. Start the connection again.' });
    } catch (err) {
      if (err instanceof Error && 'code' in err) throw err;
    }
    if (!code) throw adapterError('API_ERROR', 'eBay', { detail: 'No authorization code found in that address.' });
    await exchangeCode(code);
    const user = await tradingCall<{ User?: { UserID?: string } }>('GetUser', '');
    setKv(ctx.db, 'ebay_auth_meta', { connectedAt: new Date().toISOString(), scopes: EBAY_SCOPES, accessTokenExpiresAt: null });
    return { status: 'connected', accountName: user.User?.UserID ?? null, message: null };
  },

  async publish(ctx, l) {
    const data = l.data;
    const cat = data.categoryId;
    if (!cat) throw adapterError('API_ERROR', 'eBay', { detail: 'Choose an eBay category first.' });
    await ctx.step('auth', 'Connecting to eBay', () => getUserAccessToken());
    const conditionId = await ctx.step('condition', 'Choosing condition', async () => {
      if (data.conditionId) return data.conditionId;
      const allowed = (await getConditions(cat)).map((c) => c.conditionId);
      const picked = l.condition ? pickConditionId(l.condition, allowed) : null;
      if (picked === null) throw adapterError('API_ERROR', 'eBay', { detail: 'eBay has no matching condition for this category — choose one in the eBay settings for this item.' });
      return picked;
    });
    const aspects = await ctx.step('aspects', 'Preparing item specifics', async () =>
      mergeAspects(autoAspects(l, await getAspects(cat)), data.aspects));
    const pictureUrls = await ctx.step('photos', `Uploading ${l.photoPaths.length} photos to eBay`, async () => {
      const urls: string[] = [];
      for (const [i, file] of l.photoPaths.entries()) {
        ctx.throwIfCancelled();
        const nn = String(i + 1).padStart(2, '0');
        const fd = new FormData();
        fd.append('XML Payload', requestXml('UploadSiteHostedPictures', `<PictureName>${escapeXml(`${l.sku}-${nn}`)}</PictureName><PictureSet>Supersize</PictureSet>`));
        fd.append('image', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), `${nn}.jpg`);
        const res = await tradingCall<{ SiteHostedPictureDetails?: { FullURL?: string } }>('UploadSiteHostedPictures', '', { formData: fd });
        const full = res.SiteHostedPictureDetails?.FullURL;
        if (!full) throw adapterError('UPLOAD_FAILED', 'eBay');
        urls.push(full);
      }
      return urls;
    });
    const itemXml = buildItemXml(l, data, ctx.settings, pictureUrls, conditionId, aspects);
    const fees = await ctx.step('verify', 'Checking listing with eBay', async () => {
      const res = await tradingCall<{ Fees?: { Fee?: unknown[] } }>('VerifyAddFixedPriceItem', itemXml);
      const cents = await feeTotalCents(res);
      ctx.log.info(`eBay fee estimate: ${formatCents(cents)}`);
      return cents;
    });
    if (!ctx.prefs.autoSubmit) {
      await ctx.requestUser({
        reason: 'review_and_submit', title: 'Ready to publish on eBay',
        instructions: `eBay accepted the listing. Estimated eBay fees now: ${formatCents(fees)}. Click “Publish now” to list it.`,
        primaryAction: 'Publish now',
      });
    }
    const itemId = await ctx.step('publish', 'Publishing on eBay', async () => {
      const res = await tradingCall<{ ItemID?: string | number }>('AddFixedPriceItem', itemXml);
      if (!res.ItemID) throw adapterError('PUBLISH_NOT_CONFIRMED', 'eBay');
      return String(res.ItemID);
    });
    return { remoteId: itemId, url: itemUrl(itemId), verified: true };
  },

  async update(ctx, l, ml) {
    const id = requireItemId(ml);
    await ctx.step('revise', 'Updating eBay listing', async () => {
      const inner = `<Item><ItemID>${escapeXml(id)}</ItemID><Title>${escapeXml(l.title)}</Title><Description>${cdata(descriptionToHtml(l.description))}</Description>`
        + `<StartPrice currencyID="USD">${((l.priceCents ?? 0) / 100).toFixed(2)}</StartPrice></Item>`;
      await tradingCall('ReviseFixedPriceItem', inner);
    });
  },

  async deactivate(ctx, ml) {
    const id = requireItemId(ml);
    if (!ctx.prefs.autoSubmit) {
      await ctx.requestUser({ reason: 'confirm_delete', title: 'End eBay listing', instructions: 'Click “End listing” to end this eBay listing.', primaryAction: 'End listing' });
    }
    await ctx.step('end', 'Ending eBay listing', async () => {
      try {
        await tradingCall('EndFixedPriceItem', `<ItemID>${escapeXml(id)}</ItemID><EndingReason>NotAvailable</EndingReason>`);
      } catch (err) {
        if (err instanceof EbayTradingError && err.codes.includes('1047')) return; // already ended
        throw err;
      }
    });
  },

  async checkStatus(_ctx, ml) {
    const id = requireItemId(ml);
    type ItemShape = { SellingStatus?: { ListingStatus?: string; QuantitySold?: number | string } };
    const res = await tradingCall<{ Item?: ItemShape | ItemShape[] }>(
      'GetItem', `<ItemID>${escapeXml(id)}</ItemID><OutputSelector>Item.SellingStatus</OutputSelector><OutputSelector>Item.ListingDetails</OutputSelector>`);
    const item = Array.isArray(res.Item) ? res.Item[0] : res.Item; // the XML parser treats <Item> as a list
    const st = item?.SellingStatus;
    if (st?.ListingStatus === 'Active') return 'active';
    if ((st?.ListingStatus === 'Completed' || st?.ListingStatus === 'Ended') && Number(st.QuantitySold ?? 0) > 0) return 'sold';
    return st ? 'ended' : 'unknown';
  },

  registerRoutes(app: FastifyInstance) {
    app.get('/status', async () => ({
      configured: isConfigured(), missing: missingConfig(), env: ebayHosts().home.includes('sandbox') ? 'sandbox' : 'production', hasToken: await hasUserToken(),
    }));
    app.get('/categories/suggest', async (req) => {
      const { q } = z.object({ q: z.string().min(1) }).parse(req.query);
      return (await suggestCategories(q)).slice(0, 10);
    });
    app.get('/aspects', async (req) => getAspects(z.object({ categoryId: z.string().regex(/^\d+$/) }).parse(req.query).categoryId));
    app.get('/conditions', async (req) => getConditions(z.object({ categoryId: z.string().regex(/^\d+$/) }).parse(req.query).categoryId));
    app.get('/policies', async () => getPolicies());
    app.get('/auto-aspects', async (req) => {
      const q = z.object({ listingId: z.string(), categoryId: z.string().regex(/^\d+$/) }).parse(req.query);
      const row = app.db.select().from(listings).where(eq(listings.id, q.listingId)).get();
      if (!row) return {};
      const labels = row.categoryId ? categoryAncestry(row.categoryId).map((c) => c.label) : [];
      return autoAspects({
        brand: row.brand, size: row.size, sizeType: sizeTypeOf(row.categoryId), colors: row.colors as ColorId[], categoryId: row.categoryId,
        categoryLabels: labels, department: row.categoryId ? departmentOf(row.categoryId) : null, material: row.material, model: row.model,
      }, await getAspects(q.categoryId));
    });
    app.get('/oauth/callback', async (req, reply) => {
      const { state } = z.object({ state: z.string().optional() }).parse(req.query);
      const waiting = app.db.select().from(jobs).where(and(eq(jobs.type, 'connect'), eq(jobs.marketplaceId, 'ebay'), eq(jobs.state, 'NEEDS_USER'))).all()
        .find((j) => state !== undefined && (j.input as { state?: string } | null)?.state === state);
      reply.type('text/html; charset=utf-8');
      if (!waiting || !resolveWaiter(waiting.id, `http://${req.headers.host}${req.url}`)) {
        return '<!doctype html><title>eBay</title><p>No pending eBay connection.</p>';
      }
      return '<!doctype html><title>eBay</title><p>eBay is connected. You can close this tab.</p>';
    });
  },
};
