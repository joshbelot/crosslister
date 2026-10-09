import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  chooseMany, chooseOption, choosePath, chooseRadio, click, fillText, pace, setCheckbox, typeahead, uploadFiles, waitForUrl,
} from '../../src/server/browser/actions';
import { resolveLocator, exists, type LocatorSpec } from '../../src/server/browser/locators';
import { AdapterError } from '../../src/server/marketplaces/common';
import { fakeCtx, startBrowserEnv, type BrowserEnv } from '../helpers/browser';
import { makeJpeg } from '../helpers/fixtures';

const spec = (what: string, label: string): LocatorSpec => ({ what, candidates: [{ label }] });
const byRole = (what: string, name: string | RegExp, role: 'button' | 'radiogroup' | 'textbox' = 'button'): LocatorSpec => ({ what, candidates: [{ role, name }] });

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('browser helpers (fixtures)', () => {
  let env: BrowserEnv;
  const filled = () => env.page.evaluate(() => (window as unknown as { __filled: Record<string, unknown> }).__filled);
  beforeAll(async () => { env = await startBrowserEnv(); });
  afterAll(async () => { await env.close(); });
  beforeEach(async () => { await env.page.goto(`${env.fixtureUrl}/_helpers/helpers.html`); });

  it('resolveLocator picks the first visible candidate and throws ELEMENT_NOT_FOUND with `what`', async () => {
    const loc = await resolveLocator(env.page, { what: 'Plain input', candidates: [{ label: 'Does not exist' }, { label: 'Plain input' }] });
    expect(await loc.getAttribute('id')).toBe('t1');
    const err = await resolveLocator(env.page, { what: 'Ghost field', candidates: [{ label: 'nope' }] }, { timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.code).toBe('ELEMENT_NOT_FOUND');
    expect(err.userMessage).toContain('Ghost field');
    expect(await exists(env.page, spec('x', 'Plain input'), 300)).toBe(true);
    expect(await exists(env.page, spec('x', 'nope'), 300)).toBe(false);
  });

  it('fillText works on input, textarea, contenteditable and a controlled input that rejects the first fill', async () => {
    await fillText(env.page, spec('Plain input', 'Plain input'), 'hello world');
    await fillText(env.page, spec('Plain textarea', 'Plain textarea'), 'line one\nline two');
    await fillText(env.page, { what: 'Rich', candidates: [{ role: 'textbox', name: 'Rich text' }] }, 'rich value');
    await fillText(env.page, spec('Controlled', 'Controlled input'), 'typed value');
    const f = await filled();
    expect(f.plain).toBe('hello world');
    expect(f.textarea).toBe('line one\nline two');
    expect(f.rich).toBe('rich value');
    expect(f.controlled).toBe('typed value');
    expect(await env.page.inputValue('#ctl')).toBe('typed value');
  });

  it('uploadFiles waits for previews and fails with UPLOAD_FAILED otherwise', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-up-'));
    const files = [] as string[];
    for (let i = 0; i < 3; i++) { const f = path.join(dir, `${i + 1}.jpg`); fs.writeFileSync(f, await makeJpeg(50, 50, '#123456')); files.push(f); }
    await uploadFiles(env.page, { what: 'Photo upload', candidates: [{ label: 'Photo upload' }] }, files, { previews: { what: 'Previews', candidates: [{ css: '.preview' }] } });
    expect((await filled()).photos).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(await env.page.locator('.preview').count()).toBe(3);
    const err = await uploadFiles(env.page, { what: 'Photo upload', candidates: [{ label: 'Photo upload' }] }, files,
      { previews: { what: 'Never', candidates: [{ css: '.never-appears' }] }, timeoutMs: 700 }).catch((e) => e);
    expect(err.code).toBe('UPLOAD_FAILED');
  });

  it('chooseOption handles a native select and a custom listbox, and reports OPTION_NOT_FOUND', async () => {
    expect(await chooseOption(env.page, spec('Brand', 'Native brand'), ['Levis', "Levi's"])).toBe("Levi's");
    expect((await filled()).nativeBrand).toBe("Levi's");
    expect(await chooseOption(env.page, byRole('Condition', 'Condition dropdown'), ['Like New'])).toBe('Like new');
    expect((await filled()).condition).toBe('Like new');
    const err = await chooseOption(env.page, spec('Brand', 'Native brand'), 'Gucci').catch((e) => e);
    expect(err.code).toBe('OPTION_NOT_FOUND');
    expect(err.userMessage).toContain('Gucci');
  });

  it('choosePath walks three levels with synonyms and fails on a missing segment', async () => {
    await choosePath(env.page, byRole('Category', 'Category picker'), ['Men', ['Footwear', 'Shoes'], 'Sneakers']);
    expect((await filled()).category).toBe('Men > Shoes > Sneakers');
    const err = await choosePath(env.page, byRole('Category', 'Category picker'), ['Women', 'Shoes', 'Hats']).catch((e) => e);
    expect(err.code).toBe('CATEGORY_NOT_SELECTABLE');
    expect(err.detail).toBe('Hats');
  });

  it('chooseRadio supports role=radio buttons and native radios', async () => {
    expect(await chooseRadio(env.page, { what: 'Condition', candidates: [{ role: 'radiogroup', name: 'Condition group' }] }, ['Like new'])).toBe('Like New');
    expect((await filled()).radio).toBe('Like New');
    expect(await chooseRadio(env.page, { what: 'Radios', candidates: [{ css: 'fieldset[aria-label="Native radios"]' }] }, 'Medium')).toBe('Medium');
    expect((await filled()).nativeRadio).toBe('Medium');
    const err = await chooseRadio(env.page, { what: 'Condition', candidates: [{ role: 'radiogroup', name: 'Condition group' }] }, 'Mint').catch((e) => e);
    expect(err.code).toBe('OPTION_NOT_FOUND');
  });

  it('chooseMany selects what matches, skips the rest, and errors when nothing matches', async () => {
    const chosen = await chooseMany(env.page, byRole('Colors', 'Colors dropdown'), ['Blue', 'Black', 'Purple'], { doneButton: { what: 'Done', candidates: [{ role: 'button', name: 'Done' }] } });
    expect(chosen).toEqual(['Blue', 'Black']);
    expect((await filled()).colors).toEqual(['Blue', 'Black']);
    await env.page.reload();
    const err = await chooseMany(env.page, byRole('Colors', 'Colors dropdown'), ['Purple', 'Teal']).catch((e) => e);
    expect(err.code).toBe('OPTION_NOT_FOUND');
  });

  it('typeahead picks an exact suggestion, or accepts custom text when allowed', async () => {
    expect(await typeahead(env.page, spec('Brand', 'Brand typeahead'), 'Nike')).toBe('Nike');
    expect((await filled()).brand).toBe('Nike');
    await env.page.reload();
    const err = await typeahead(env.page, spec('Brand', 'Brand typeahead'), 'Obscure Label').catch((e) => e);
    expect(err.code).toBe('OPTION_NOT_FOUND');
    await env.page.reload();
    expect(await typeahead(env.page, spec('Brand', 'Brand typeahead'), 'Obscure Label', { allowCustom: true })).toBe('Obscure Label');
    expect((await filled()).brandCustom).toBe('Obscure Label');
  });

  it('click, setCheckbox, pace and waitForUrl', async () => {
    await setCheckbox(env.page, spec('Free shipping', 'Free shipping'), true);
    expect((await filled()).checkbox).toBe(true);
    await setCheckbox(env.page, spec('Free shipping', 'Free shipping'), false);
    expect((await filled()).checkbox).toBe(false);
    await click(env.page, byRole('Category', 'Category picker'));
    await pace(fakeCtx());
    const ac = new AbortController();
    const waiting = waitForUrl(env.page, /\/mercari\/us\/item\/m\d+\/?$/, ac.signal, 8000);
    await env.page.evaluate(() => { setTimeout(() => history.pushState({}, '', '/mercari/us/item/m123/'), 200); });
    expect(await waiting).toContain('/mercari/us/item/m123/');
    const ac2 = new AbortController();
    const aborted = waitForUrl(env.page, /never/, ac2.signal);
    ac2.abort();
    expect((await aborted.catch((e) => e)).code).toBe('CANCELLED');
    await expect(waitForUrl(env.page, /never/, new AbortController().signal, 300)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
