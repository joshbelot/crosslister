import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColorId } from '../../shared/colors';
import type { Condition, MarketplaceId } from '../../shared/constants';
import type { Measurements, ShippingInfo } from '../../shared/types';
import { api } from '../api/client';
import { useCreateListing, useListing, useMarketplaces, usePatchListing, useRecent, useSetTargets, useSettings } from '../api/hooks';
import type { ListingDetail } from '../../shared/types';

export interface FormValues {
  title: string; description: string; priceCents: number | null; msrpCents: number | null; costCents: number | null;
  condition: Condition | null; conditionNotes: string; categoryId: string | null; brand: string; model: string; size: string;
  colors: ColorId[]; material: string; quantity: number; measurements: Measurements; tags: string[]; shipping: ShippingInfo; notes: string;
}
export type FieldName = keyof FormValues;
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const EMPTY_SHIPPING: ShippingInfo = { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' };
const FIELDS: FieldName[] = ['title', 'description', 'priceCents', 'msrpCents', 'costCents', 'condition', 'conditionNotes', 'categoryId', 'brand', 'model', 'size', 'colors', 'material', 'quantity', 'measurements', 'tags', 'shipping', 'notes'];
const RETRY_MS = [2000, 5000, 10000];

export function emptyValues(shipping: ShippingInfo = EMPTY_SHIPPING): FormValues {
  return {
    title: '', description: '', priceCents: null, msrpCents: null, costCents: null, condition: null, conditionNotes: '',
    categoryId: null, brand: '', model: '', size: '', colors: [], material: '', quantity: 1, measurements: {}, tags: [], shipping, notes: '',
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const norm = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map(norm) : v);

export function useListingDraft(routeId: string) {
  const navigate = useNavigate();
  const settings = useSettings().data;
  const recent = useRecent().data;
  const marketplaces = useMarketplaces().data;
  const createMutation = useCreateListing();
  const patchMutation = usePatchListing();
  const setTargets = useSetTargets();

  const [listingId, setListingId] = useState<string | null>(routeId === 'new' ? null : routeId);
  const idRef = useRef<string | null>(listingId);
  const creatingRef = useRef<Promise<string> | null>(null);
  const [values, setValues] = useState<FormValues>(() => emptyValues());
  const valuesRef = useRef(values);
  const dirtyRef = useRef(new Set<FieldName>());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timerRef = useRef<number | undefined>(undefined);
  const retryRef = useRef(0);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const knownUpdatedAt = useRef('');
  const hydratedFor = useRef<string | null>(null);

  // A route change to another listing resets everything; 'new' → created id keeps state (same component, ref guards).
  useEffect(() => {
    if (routeId === 'new') return;
    if (idRef.current !== routeId) {
      idRef.current = routeId;
      setListingId(routeId);
      hydratedFor.current = null;
      dirtyRef.current.clear();
      knownUpdatedAt.current = '';
    }
  }, [routeId]);

  const listingQuery = useListing(listingId ?? undefined);
  const listing = listingQuery.data;

  // Defaults for a brand-new listing once settings are known.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (routeId !== 'new' || defaultsApplied.current || !settings || dirtyRef.current.size > 0 || idRef.current) return;
    defaultsApplied.current = true;
    setValues((v) => { const next = { ...v, shipping: { ...settings.shippingDefaults } }; valuesRef.current = next; return next; });
  }, [routeId, settings]);

  // Marketplace selection.
  const [selected, setSelectedState] = useState<MarketplaceId[]>([]);
  const selectedRef = useRef<MarketplaceId[]>([]);
  const selectionInit = useRef(false);
  const enabledIds = useMemo(() => new Set((marketplaces ?? []).filter((m) => m.prefs.enabled).map((m) => m.id)), [marketplaces]);
  useEffect(() => {
    if (selectionInit.current || !settings || !recent || !marketplaces) return;
    if (routeId === 'new') {
      const base = settings.rememberLastMarketplaces && recent.lastMarketplaces.length ? recent.lastMarketplaces : settings.defaultMarketplaces;
      selectionInit.current = true;
      const init = base.filter((id) => enabledIds.has(id));
      selectedRef.current = init;
      setSelectedState(init);
    }
  }, [routeId, settings, recent, marketplaces, enabledIds]);
  useEffect(() => {
    if (selectionInit.current || !listing || routeId === 'new') return;
    selectionInit.current = true;
    const ids = listing.marketplaces.map((m) => m.marketplaceId);
    selectedRef.current = ids;
    setSelectedState(ids);
  }, [listing, routeId]);

  const applyServer = useCallback((l: ListingDetail, force: boolean) => {
    const next = { ...valuesRef.current };
    let changed = false;
    for (const k of FIELDS) {
      if (dirtyRef.current.has(k)) continue;
      const server = (l as unknown as Record<string, unknown>)[k];
      if (!force && same(norm(server), norm(next[k]))) continue;
      if (same(server, next[k])) continue;
      (next as Record<string, unknown>)[k] = server;
      changed = true;
    }
    if (changed) { valuesRef.current = next; setValues(next); }
  }, []);

  // Hydrate on first load; afterwards only for changes that didn't come from this editor.
  useEffect(() => {
    if (!listing) return;
    const first = hydratedFor.current !== listing.id;
    if (first) { hydratedFor.current = listing.id; applyServer(listing, false); knownUpdatedAt.current = listing.updatedAt; return; }
    if (listing.updatedAt > knownUpdatedAt.current) { knownUpdatedAt.current = listing.updatedAt; applyServer(listing, false); }
  }, [listing, applyServer]);

  const ack = (sent: Partial<FormValues>) => {
    for (const k of Object.keys(sent) as FieldName[]) if (same(valuesRef.current[k], sent[k])) dirtyRef.current.delete(k);
  };

  const ensureCreated = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    if (!creatingRef.current) {
      creatingRef.current = (async () => {
        const body = { ...valuesRef.current };
        const created = await createMutation.mutateAsync(body);
        idRef.current = created.id;
        knownUpdatedAt.current = created.updatedAt;
        hydratedFor.current = created.id;
        ack(body);
        if (selectedRef.current.length) await setTargets.mutateAsync({ id: created.id, marketplaceIds: selectedRef.current });
        setListingId(created.id);
        navigate(`/listings/${created.id}/edit`, { replace: true });
        return created.id;
      })();
      creatingRef.current.catch(() => { creatingRef.current = null; });
    }
    return creatingRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMutation, setTargets, navigate]);

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timerRef.current);
    if (dirtyRef.current.size === 0) return;
    if (savingRef.current) { againRef.current = true; return; }
    savingRef.current = true;
    setSaveState('saving');
    try {
      if (!idRef.current) {
        await ensureCreated();
      } else {
        const sent: Partial<FormValues> = {};
        for (const k of dirtyRef.current) (sent as Record<string, unknown>)[k] = valuesRef.current[k];
        const res = await patchMutation.mutateAsync({ id: idRef.current, patch: sent as never });
        knownUpdatedAt.current = res.updatedAt;
        ack(sent);
      }
      retryRef.current = 0;
      setSaveState(dirtyRef.current.size ? 'saving' : 'saved');
    } catch {
      setSaveState('error');
      const delay = RETRY_MS[retryRef.current] ?? 30_000;
      retryRef.current++;
      timerRef.current = window.setTimeout(() => { void flush(); }, delay);
      savingRef.current = false;
      return;
    }
    savingRef.current = false;
    if (againRef.current || dirtyRef.current.size > 0) { againRef.current = false; timerRef.current = window.setTimeout(() => { void flush(); }, 50); }
  }, [ensureCreated, patchMutation]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const setField = useCallback(<K extends FieldName>(name: K, value: FormValues[K]) => {
    const next = { ...valuesRef.current, [name]: value };
    valuesRef.current = next;
    setValues(next);
    dirtyRef.current.add(name);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flushRef.current(); }, 800);
  }, []);

  // Flush on unmount and before the page unloads.
  useEffect(() => {
    const onUnload = () => {
      if (dirtyRef.current.size === 0 || !idRef.current) return;
      const sent: Record<string, unknown> = {};
      for (const k of dirtyRef.current) sent[k] = valuesRef.current[k];
      void api.patchKeepalive(`/api/listings/${idRef.current}`, sent);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current.size > 0) void flushRef.current();
    };
  }, []);

  const targetsTimer = useRef<number | undefined>(undefined);
  const setSelected = useCallback((ids: MarketplaceId[]) => {
    selectedRef.current = ids;
    setSelectedState(ids);
    window.clearTimeout(targetsTimer.current);
    targetsTimer.current = window.setTimeout(() => {
      if (idRef.current) setTargets.mutate({ id: idRef.current, marketplaceIds: ids });
    }, 300);
  }, [setTargets]);

  return {
    listingId, listing, values, setField, saveState, flush, ensureCreated, selected, setSelected,
    isDirty: () => dirtyRef.current.size > 0,
    loading: routeId !== 'new' && listingQuery.isLoading,
    notFound: routeId !== 'new' && listingQuery.isError,
  };
}
