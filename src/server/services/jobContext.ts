import type { Page } from 'playwright';
import type { MarketplaceId } from '../../shared/constants';
import type { Job, MarketplacePrefs, NeedsUserRequest, Settings } from '../../shared/types';
import type { Db } from '../db/client';

export interface JobContext {
  db: Db; job: Job; marketplaceId: MarketplaceId; adapterName: string;
  settings: Settings; prefs: MarketplacePrefs;
  signal: AbortSignal;
  log: { debug(m: string, d?: unknown): void; info(m: string, d?: unknown): void; warn(m: string, d?: unknown): void; error(m: string, d?: unknown): void };
  /** Required step. Records a step row; on throw marks it failed (+screenshot) and rethrows. */
  step<T>(key: string, label: string, fn: () => Promise<T>): Promise<T>;
  /** Optional step. On throw: step state 'needs_user', message "Couldn't fill automatically — please fill “<label>” in the browser", push label to missingFields, return false. */
  tryStep(key: string, label: string, fn: () => Promise<void>): Promise<boolean>;
  missingFields: string[];
  /** Pause for the user. Resolves when POST /continue arrives. Rejects with CANCELLED on cancel. */
  requestUser(req: NeedsUserRequest): Promise<{ url: string | null }>;
  /** Pause for the user OR resolve automatically when `detect` resolves first (detect gets an AbortSignal that aborts when the user answers). */
  requestUserUntil<T>(req: NeedsUserRequest, detect: (signal: AbortSignal) => Promise<T>): Promise<{ by: 'detected'; value: T } | { by: 'user'; url: string | null }>;
  throwIfCancelled(): void;
  sleep(ms: number): Promise<void>;           // cancellable
  page(): Promise<Page>;                      // browser adapters: browserManager.getPage(mp)
  screenshot(label: string): Promise<string | null>;
}
