import type { Locator, Page } from 'playwright';
import { AdapterError, adapterError } from '../marketplaces/common';

export type LocatorCandidate =
  | { role: Parameters<Page['getByRole']>[0]; name: string | RegExp; exact?: boolean }
  | { label: string | RegExp; exact?: boolean }
  | { placeholder: string | RegExp }
  | { testId: string }
  | { text: string | RegExp; exact?: boolean }
  | { css: string };
export interface LocatorSpec { what: string; candidates: LocatorCandidate[] }

export function toLocator(scope: Page | Locator, c: LocatorCandidate): Locator {
  if ('role' in c) return scope.getByRole(c.role, { name: c.name, exact: c.exact });
  if ('label' in c) return scope.getByLabel(c.label, { exact: c.exact });
  if ('placeholder' in c) return scope.getByPlaceholder(c.placeholder);
  if ('testId' in c) return scope.getByTestId(c.testId);
  if ('text' in c) return scope.getByText(c.text, { exact: c.exact });
  return scope.locator(c.css);
}

/**
 * Combine all candidates with `.or()` and wait for the first match. Candidate order expresses preference only
 * through Playwright's DOM order for `.first()`; the first candidate is the one the fixtures use.
 */
export async function resolveLocator(
  scope: Page | Locator, spec: LocatorSpec, opts: { timeoutMs?: number; state?: 'visible' | 'attached'; marketplaceName?: string } = {},
): Promise<Locator> {
  const [head, ...rest] = spec.candidates;
  if (!head) throw new AdapterError('ELEMENT_NOT_FOUND', `Couldn't find “${spec.what}”.`, spec.what);
  let combined = toLocator(scope, head);
  for (const c of rest) combined = combined.or(toLocator(scope, c));
  const loc = combined.first();
  try {
    await loc.waitFor({ state: opts.state ?? 'visible', timeout: opts.timeoutMs ?? 6000 });
  } catch {
    throw adapterError('ELEMENT_NOT_FOUND', opts.marketplaceName ?? 'The marketplace', { what: spec.what });
  }
  return loc;
}

export async function exists(scope: Page | Locator, spec: LocatorSpec, timeoutMs = 1500): Promise<boolean> {
  try {
    await resolveLocator(scope, spec, { timeoutMs });
    return true;
  } catch {
    return false;
  }
}
