import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { __setProviderForTest, type AiProvider, type AiRequest } from '../../src/server/ai/provider';
import { inventsWords } from '../../src/server/ai/features';
import { renderItemDetails } from '../../src/server/ai/prompts';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

let t: TestApp;
const calls: AiRequest[] = [];
const fake = (answers: string[]): AiProvider => ({
  name: 'fake', health: async () => ({ ok: true, message: 'ok' }),
  complete: async (r) => { calls.push(r); return answers.shift() ?? '{}'; },
});

beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });
afterEach(() => { __setProviderForTest(null); calls.length = 0; });

describe('AI disabled', () => {
  it('every feature route returns AI_DISABLED', async () => {
    const l = await seedListing(t.app);
    for (const url of ['/api/ai/description', '/api/ai/titles']) {
      const r = await req(t.app, 'POST', url, { listingId: l.id });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatchObject({ code: 'AI_DISABLED', message: 'AI is turned off in Settings.' });
    }
  });
});

describe('description', () => {
  it('sends the item facts and the shared system prompt, returns the text without saving it', async () => {
    const l = await seedListing(t.app, { description: 'Seller note here', conditionNotes: 'Small stain on cuff' });
    __setProviderForTest(fake(['{"description":"A fine pair of jeans.\\n- Size 32"}']));
    const r = await req(t.app, 'POST', '/api/ai/description', { listingId: l.id });
    expect(r.json()).toEqual({ description: 'A fine pair of jeans.\n- Size 32' });
    expect(calls[0]!.system).toContain('Never invent');
    expect(calls[0]!.prompt).toContain("Brand: Levi's");
    expect(calls[0]!.prompt).toContain('Condition notes: Small stain on cuff');
    expect(calls[0]!.json).toBe(true);
    expect((await req(t.app, 'GET', `/api/listings/${l.id}`)).json().description).toBe('Seller note here');
  });
  it('retries once on invalid JSON and then reports AI_ERROR', async () => {
    const l = await seedListing(t.app);
    __setProviderForTest(fake(['garbage', 'still garbage']));
    const r = await req(t.app, 'POST', '/api/ai/description', { listingId: l.id });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('AI_ERROR');
    expect(calls).toHaveLength(2);
  });
});

describe('titles', () => {
  it('uses the smallest marketplace limit, drops long titles and titles with invented words', async () => {
    const l = await seedListing(t.app, { title: 'Levi 501 Jeans', brand: "Levi's", size: '32', colors: ['blue'] });
    __setProviderForTest(fake([JSON.stringify({ titles: [
      "Levi's 501 Jeans Blue 32", // fine
      'Rare Authentic Levis Selvedge Jeans', // invented words
      "Levi's Men's Jeans 32 Blue Straight Leg Button Fly Vintage Wash Denim Pants Excellent Condition Classic Fit", // too long
      "Levi's 501 Jeans Blue 32", // duplicate
    ] })]));
    const r = (await req(t.app, 'POST', '/api/ai/titles', { listingId: l.id, marketplaceIds: ['depop'] })).json();
    expect(r.titles).toEqual(["Levi's 501 Jeans Blue 32"]);
    expect(r.maxLen).toBeLessThanOrEqual(80);
    expect(calls[0]!.prompt).toContain(`at most ${r.maxLen} characters`);
  });
  it('defaults to 80 characters without marketplaces', async () => {
    const l = await seedListing(t.app);
    __setProviderForTest(fake(['{"titles":[]}']));
    expect((await req(t.app, 'POST', '/api/ai/titles', { listingId: l.id })).json()).toEqual({ titles: [], maxLen: 80 });
  });
});

describe('helpers', () => {
  it('inventsWords ignores filler and category words', () => {
    const allowed = new Set(['levis', 'jeans', 'blue', 'with', 'the']);
    expect(inventsWords('Levis Jeans Blue', allowed)).toBe(false);
    expect(inventsWords('Levis Selvedge Jeans', allowed)).toBe(true);
  });
  it('renderItemDetails omits empty fields', async () => {
    const l = (await req(t.app, 'POST', '/api/listings', { title: 'Only title' })).json();
    expect(renderItemDetails(l)).toBe('- Title: Only title');
  });
});
