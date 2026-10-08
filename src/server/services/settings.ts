import { eq } from 'drizzle-orm';
import { settingsSchema } from '../../shared/schemas';
import type { Settings } from '../../shared/types';
import type { Db } from '../db/client';
import { settings as settingsTable } from '../db/schema';

export const DEFAULT_SETTINGS: Settings = {
  shippingDefaults: { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' },
  descriptionFooter: '',
  defaultMarketplaces: ['mercari', 'poshmark', 'depop', 'facebook'],
  rememberLastMarketplaces: true,
  marketplaces: {
    mercari:  { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    poshmark: { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    depop:    { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    facebook: { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 10 },
    ebay:     { enabled: true,  autoSubmit: true,  priceAdjustPercent: 0, dailyLimit: 50 },
    grailed:  { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    vinted:   { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    offerup:  { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    etsy:     { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    other:    { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 100 },
  },
  browser: { channel: 'chrome', slowMoMs: 0, closeIdleMinutes: 20 },
  ebay: { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null, postalCode: '', dispatchTimeDays: 1 },
  ai: { enabled: false, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', textModel: 'gemma3:4b', visionModel: 'gemma3:4b' },
  statusChecks: { ebayPollingEnabled: false, ebayIntervalMinutes: 30 },
};

export function getKv<T>(db: Db, key: string, fallback: T): T {
  const row = db.select().from(settingsTable).where(eq(settingsTable.key, key)).get();
  return row ? (row.value as T) : fallback;
}

export function setKv(db: Db, key: string, value: unknown): void {
  db.insert(settingsTable).values({ key, value: value ?? null })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: value ?? null } }).run();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

/** Deep-merge the stored 'app' value over DEFAULT_SETTINGS (stored wins; unknown keys dropped). */
export function getSettings(db: Db): Settings {
  const stored = getKv<unknown>(db, 'app', null);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  const parsed = settingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, stored));
  return parsed.success ? (parsed.data as Settings) : structuredClone(DEFAULT_SETTINGS);
}

/** Adapters whose capabilities forbid auto-submit (filled in by the marketplace registry from M8 on). */
let noAutoSubmitIds: () => string[] = () => ['facebook'];
export function setNoAutoSubmitProvider(fn: () => string[]): void {
  noAutoSubmitIds = fn;
}

export function saveSettings(db: Db, s: Settings): Settings {
  const parsed = settingsSchema.parse(s) as Settings;
  parsed.marketplaces.facebook.autoSubmit = false;
  for (const id of noAutoSubmitIds()) {
    const prefs = (parsed.marketplaces as Record<string, { autoSubmit: boolean }>)[id];
    if (prefs) prefs.autoSubmit = false;
  }
  setKv(db, 'app', parsed);
  return parsed;
}
