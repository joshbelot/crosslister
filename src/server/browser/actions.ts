import type { Locator, Page } from 'playwright';
import { AdapterError, adapterError } from '../marketplaces/adapterError';
import type { JobContext } from '../services/jobContext';
import { logger } from '../services/logger';
import { combinedLocator, resolveLocator, type LocatorSpec } from './locators';
import { bestMatch } from './match';

const OPTION_SELECTOR = '[role=option], [role=menuitem], [role=radio], li, button';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const first = (w: string | string[]) => (Array.isArray(w) ? w[0] ?? '' : w);

export async function click(page: Page, spec: LocatorSpec): Promise<void> {
  const loc = await resolveLocator(page, spec);
  await loc.click();
}

export async function fillText(page: Page, spec: LocatorSpec, value: string): Promise<void> {
  const loc = await resolveLocator(page, spec);
  await loc.click();
  const editable = await loc.evaluate((el) => (el as HTMLElement).isContentEditable);
  const read = async () => norm(editable ? await loc.innerText() : await loc.inputValue());
  const wanted = norm(value);
  if (editable) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
  } else {
    await loc.fill(value);
  }
  if ((await read()) === wanted) return;
  // React-controlled inputs sometimes drop programmatic fills; type the value instead (not to disguise automation).
  if (editable) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
  } else {
    await loc.fill('');
  }
  await loc.pressSequentially(value, { delay: 15 });
  if ((await read()) === wanted) return;
  throw adapterError('FILL_FAILED', null, { what: spec.what });
}

export async function uploadFiles(page: Page, spec: LocatorSpec, files: string[], opts: { previews?: LocatorSpec; timeoutMs?: number } = {}): Promise<void> {
  const input = await resolveLocator(page, spec, { state: 'attached' });
  await input.setInputFiles(files);
  if (!opts.previews) {
    await wait(page, Math.min(20_000, 2000 * files.length));
    return;
  }
  const previews = combinedLocator(page, opts.previews);
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  for (;;) {
    if ((await previews.count()) >= files.length) return;
    if (Date.now() > deadline) throw adapterError('UPLOAD_FAILED', null, { what: spec.what });
    await wait(page, 300);
  }
}

/** The last visible listbox/menu/dialog (where an open dropdown renders its options), else the whole page. */
async function defaultOptionScope(page: Page): Promise<Locator> {
  const scopes = page.locator('[role=listbox], [role=menu], [role=dialog]');
  const n = await scopes.count();
  for (let i = n - 1; i >= 0; i--) if (await scopes.nth(i).isVisible()) return scopes.nth(i);
  return page.locator('body');
}

async function collectOptions(page: Page, scope: Locator): Promise<Array<{ text: string; index: number }>> {
  const items = await scope.locator(OPTION_SELECTOR).evaluateAll((els) =>
    els.map((el, index) => {
      const e = el as HTMLElement;
      const visible = !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return { text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), index, visible };
    }));
  void page;
  return items.filter((i) => i.visible && i.text);
}

async function pickFromScope(page: Page, scope: Locator, wanted: string | string[], what: string, minScore?: number): Promise<string> {
  const options = await collectOptions(page, scope);
  const match = bestMatch(wanted, options.map((o) => o.text), minScore);
  if (!match) throw adapterError('OPTION_NOT_FOUND', null, { value: first(wanted), what });
  const target = options.find((o) => o.text === match.option)!;
  await scope.locator(OPTION_SELECTOR).nth(target.index).click();
  return match.option;
}

async function scopeFor(page: Page, optionScope?: LocatorSpec): Promise<Locator> {
  return optionScope ? resolveLocator(page, optionScope) : defaultOptionScope(page);
}

export async function chooseOption(page: Page, trigger: LocatorSpec, wanted: string | string[], opts: { optionScope?: LocatorSpec } = {}): Promise<string> {
  const loc = await resolveLocator(page, trigger);
  if ((await loc.evaluate((el) => el.tagName)) === 'SELECT') {
    const texts = (await loc.locator('option').allInnerTexts()).map(norm).filter(Boolean);
    const match = bestMatch(wanted, texts);
    if (!match) throw adapterError('OPTION_NOT_FOUND', null, { value: first(wanted), what: trigger.what });
    await loc.selectOption({ label: match.option });
    return match.option;
  }
  await loc.click();
  await wait(page, 400);
  return pickFromScope(page, await scopeFor(page, opts.optionScope), wanted, trigger.what);
}

export async function choosePath(page: Page, trigger: LocatorSpec | null, path: Array<string | string[]>, opts: { optionScope?: LocatorSpec } = {}): Promise<void> {
  if (trigger) {
    await (await resolveLocator(page, trigger)).click();
  }
  for (const segment of path) {
    await wait(page, 400);
    try {
      await pickFromScope(page, await scopeFor(page, opts.optionScope), segment, trigger?.what ?? 'category');
    } catch (err) {
      if (err instanceof AdapterError && err.code === 'OPTION_NOT_FOUND') {
        throw adapterError('CATEGORY_NOT_SELECTABLE', null, { detail: first(segment) });
      }
      throw err;
    }
  }
  await wait(page, 400);
}

export async function chooseRadio(page: Page, group: LocatorSpec, wanted: string | string[]): Promise<string> {
  const scope = await resolveLocator(page, group);
  const selector = '[role=radio], input[type=radio], button, label';
  const items = await scope.locator(selector).evaluateAll((els) =>
    els.map((el, index) => {
      const e = el as HTMLElement;
      const isInput = e.tagName === 'INPUT';
      const labelText = isInput ? ((e as HTMLInputElement).labels?.[0]?.innerText ?? '') : '';
      const control = e.tagName === 'LABEL' ? (e as HTMLLabelElement).control : null;
      const skip = !!control && (control as HTMLInputElement).type === 'radio';
      const text = (labelText || e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return { index, text, isInput, skip };
    }));
  const usable = items.filter((i) => !i.skip && i.text);
  const match = bestMatch(wanted, usable.map((i) => i.text));
  if (!match) throw adapterError('OPTION_NOT_FOUND', null, { value: first(wanted), what: group.what });
  const target = usable.find((i) => i.text === match.option)!;
  const el = scope.locator(selector).nth(target.index);
  if (target.isInput) await el.check({ force: true });
  else await el.click();
  return match.option;
}

export async function chooseMany(
  page: Page, trigger: LocatorSpec, wanted: Array<string | string[]>, opts: { optionScope?: LocatorSpec; doneButton?: LocatorSpec } = {},
): Promise<string[]> {
  await (await resolveLocator(page, trigger)).click();
  await wait(page, 400);
  const chosen: string[] = [];
  for (const w of wanted) {
    try {
      chosen.push(await pickFromScope(page, await scopeFor(page, opts.optionScope), w, trigger.what));
    } catch (err) {
      if (!(err instanceof AdapterError && err.code === 'OPTION_NOT_FOUND')) throw err;
      logger.warn('BROWSER', `No option matching “${first(w)}” for ${trigger.what}`);
    }
  }
  if (opts.doneButton) await click(page, opts.doneButton);
  else await page.keyboard.press('Escape');
  if (chosen.length === 0) throw adapterError('OPTION_NOT_FOUND', null, { value: wanted.map(first).join(', '), what: trigger.what });
  return chosen;
}

export async function typeahead(page: Page, input: LocatorSpec, value: string, opts: { allowCustom?: boolean; minScore?: number } = {}): Promise<string> {
  await fillText(page, input, value);
  await wait(page, 900);
  try {
    return await pickFromScope(page, await defaultOptionScope(page), value, input.what, opts.minScore ?? 0.8);
  } catch (err) {
    if (err instanceof AdapterError && err.code === 'OPTION_NOT_FOUND' && opts.allowCustom) {
      await page.keyboard.press('Enter');
      return value;
    }
    throw err;
  }
}

export async function setCheckbox(page: Page, spec: LocatorSpec, checked: boolean): Promise<void> {
  const loc = await resolveLocator(page, spec);
  try {
    await loc.setChecked(checked);
  } catch {
    if ((await loc.isChecked().catch(() => !checked)) !== checked) await loc.click();
  }
}

/** Random 250–700 ms pause between fields. */
export async function pace(ctx: JobContext): Promise<void> {
  await ctx.sleep(250 + Math.floor(Math.random() * 450));
}

/** Resolves with the page URL once its pathname matches; rejects on abort or timeout. */
export async function waitForUrl(page: Page, pathRegex: RegExp, signal: AbortSignal, timeoutMs?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const matches = () => { try { return pathRegex.test(new URL(page.url()).pathname); } catch { return false; } };
    let poll: NodeJS.Timeout;
    let timer: NodeJS.Timeout | undefined;
    const done = (fn: () => void) => {
      clearInterval(poll); if (timer) clearTimeout(timer);
      page.off('framenavigated', check); signal.removeEventListener('abort', onAbort); fn();
    };
    const check = () => { if (matches()) done(() => resolve(page.url())); };
    const onAbort = () => done(() => reject(adapterError('CANCELLED', null)));
    if (signal.aborted) return reject(adapterError('CANCELLED', null));
    page.on('framenavigated', check);
    signal.addEventListener('abort', onAbort, { once: true });
    poll = setInterval(check, 1000);
    if (timeoutMs) timer = setTimeout(() => done(() => reject(adapterError('TIMEOUT', null))), timeoutMs);
    check();
  });
}
