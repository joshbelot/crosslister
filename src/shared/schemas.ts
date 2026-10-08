import { z } from 'zod';
import { CONDITIONS, MARKETPLACE_IDS } from './constants';
import { COLOR_IDS, MAX_COLORS, type ColorId } from './colors';
import { isSelectableCategory } from './taxonomy';

export const conditionSchema = z.enum(CONDITIONS);
export const marketplaceIdSchema = z.enum(MARKETPLACE_IDS);
export const colorIdSchema = z.enum(COLOR_IDS as [ColorId, ...ColorId[]]);

const inches = z.number().positive().max(200).optional();
export const measurementsSchema = z.object({
  chestIn: inches, waistIn: inches, hipIn: inches, inseamIn: inches, riseIn: inches,
  lengthIn: inches, shoulderIn: inches, sleeveIn: inches,
  widthIn: inches, heightIn: inches, depthIn: inches,
}).strict();

export const shippingSchema = z.object({
  weightOz: z.number().positive().max(2400).nullable(),
  lengthIn: z.number().positive().max(200).nullable(),
  widthIn: z.number().positive().max(200).nullable(),
  heightIn: z.number().positive().max(200).nullable(),
  whoPays: z.enum(['buyer', 'seller']),
});

export const listingPatchSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(10_000),
  priceCents: z.number().int().min(0).max(10_000_000).nullable(),
  msrpCents: z.number().int().min(0).max(10_000_000).nullable(),
  costCents: z.number().int().min(0).max(10_000_000).nullable(),
  condition: conditionSchema.nullable(),
  conditionNotes: z.string().max(2000),
  categoryId: z.string().refine(isSelectableCategory, 'Unknown category').nullable(),
  brand: z.string().max(100),
  model: z.string().max(100),
  size: z.string().max(40),
  colors: z.array(colorIdSchema).max(MAX_COLORS),
  material: z.string().max(100),
  quantity: z.number().int().min(1).max(999),
  measurements: measurementsSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  shipping: shippingSchema,
  notes: z.string().max(10_000),
}).partial().strict();
export type ListingPatch = z.infer<typeof listingPatchSchema>;

export const listingCreateSchema = listingPatchSchema; // all optional; server fills defaults

export const marketplaceTargetsSchema = z.object({ marketplaceIds: z.array(marketplaceIdSchema) });

export const marketplaceListingPatchSchema = z.object({
  titleOverride: z.string().max(200).nullable(),
  descriptionOverride: z.string().max(10_000).nullable(),
  priceOverrideCents: z.number().int().min(0).max(10_000_000).nullable(),
  data: z.record(z.string(), z.unknown()),
}).partial().strict();
export type MarketplaceListingPatch = z.infer<typeof marketplaceListingPatchSchema>;

export const crosslistSchema = z.object({ marketplaceIds: z.array(marketplaceIdSchema).min(1) });
export const markListedSchema = z.object({
  url: z.string().url().nullable().optional(),
  remoteId: z.string().max(200).nullable().optional(),
});
export const markSoldSchema = z.object({
  marketplaceId: z.union([marketplaceIdSchema, z.literal('elsewhere')]),
  soldPriceCents: z.number().int().min(0).nullable().optional(),
  soldAt: z.string().datetime().optional(),
  deactivateMarketplaceIds: z.array(marketplaceIdSchema).default([]),
});
export const continueJobSchema = z.object({ url: z.string().url().nullable().optional() });
export const photoOrderSchema = z.object({ photoIds: z.array(z.string()).min(1) });
export const photoEditSchema = z.object({
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  crop: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1), height: z.number().gt(0).max(1),
  }).nullable().optional(),
}).strict();

const marketplacePrefsSchema = z.object({
  enabled: z.boolean(),
  autoSubmit: z.boolean(),
  priceAdjustPercent: z.number().min(-50).max(100),
  dailyLimit: z.number().int().min(1).max(200),
});

export const settingsSchema = z.object({
  shippingDefaults: shippingSchema,
  descriptionFooter: z.string().max(500),
  defaultMarketplaces: z.array(marketplaceIdSchema),
  rememberLastMarketplaces: z.boolean(),
  marketplaces: z.object(
    Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, marketplacePrefsSchema])) as Record<
      (typeof MARKETPLACE_IDS)[number], typeof marketplacePrefsSchema
    >,
  ),
  browser: z.object({
    channel: z.enum(['chrome', 'chromium']),
    slowMoMs: z.number().int().min(0).max(2000),
    closeIdleMinutes: z.number().int().min(1).max(240),
  }),
  ebay: z.object({
    fulfillmentPolicyId: z.string().nullable(),
    paymentPolicyId: z.string().nullable(),
    returnPolicyId: z.string().nullable(),
    postalCode: z.string().regex(/^(\d{5})?$/),
    dispatchTimeDays: z.number().int().min(0).max(30),
  }),
  ai: z.object({
    enabled: z.boolean(),
    provider: z.enum(['ollama', 'openai_compatible', 'anthropic']),
    baseUrl: z.string().max(300),
    textModel: z.string().max(100),
    visionModel: z.string().max(100),
  }),
  statusChecks: z.object({
    ebayPollingEnabled: z.boolean(),
    ebayIntervalMinutes: z.number().int().min(15).max(1440),
  }),
});
