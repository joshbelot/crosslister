import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InventoryFilter, MarketplaceId } from '../../shared/constants';
import type { ListingPatch, MarketplaceListingPatch } from '../../shared/schemas';
import type {
  Job, ListingDetail, ListingSummary, LogEntry, MarketplaceInfo, MarketplaceListing, Photo, Settings, ValidationReport,
} from '../../shared/types';
import { api, ApiError } from './client';

export interface ListingQuery { filter: InventoryFilter; q: string; sort: string }
export interface ListingsResponse { items: ListingSummary[]; counts: Record<InventoryFilter, number> }
export interface UploadResponse { photos: Photo[]; errors: string[]; notes: string[] }
export interface CrosslistResponse { jobs: Job[]; skipped: Array<{ marketplaceId: MarketplaceId; reason: string }> }
export interface RecentResponse { recentCategories: string[]; lastMarketplaces: MarketplaceId[]; brands: string[] }
export interface LogFilters { level: 'info' | 'warn' | 'error'; marketplaceId: string; q: string; listingId?: string; jobId?: string }

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------- queries
export const useListings = (query: ListingQuery) =>
  useQuery({ queryKey: ['listings', query], queryFn: () => api.get<ListingsResponse>(`/api/listings${qs({ ...query })}`), placeholderData: (prev) => prev });

export const useListing = (id: string | undefined) =>
  useQuery({ queryKey: ['listing', id], queryFn: () => api.get<ListingDetail>(`/api/listings/${id}`), enabled: !!id && id !== 'new' });

export const useValidation = (id: string | undefined, mps: MarketplaceId[], enabled = true) =>
  useQuery({
    queryKey: ['validation', id, mps],
    queryFn: () => api.get<ValidationReport>(`/api/listings/${id}/validation?marketplaceIds=${mps.join(',')}`),
    enabled: !!id && id !== 'new' && mps.length > 0 && enabled,
  });

export const useMarketplaces = () => useQuery({ queryKey: ['marketplaces'], queryFn: () => api.get<MarketplaceInfo[]>('/api/marketplaces') });

export const useJobs = (params: { listingId?: string; active?: boolean } = {}) =>
  useQuery({
    queryKey: ['jobs', params],
    queryFn: async () => (await api.get<{ items: Job[] }>(`/api/jobs${qs({ listingId: params.listingId, active: params.active ? '1' : undefined })}`)).items,
  });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
export const useRecent = () => useQuery({ queryKey: ['recent'], queryFn: () => api.get<RecentResponse>('/api/settings/kv/recent') });

export const useCategoryMap = (mp: MarketplaceId | null) =>
  useQuery({
    queryKey: ['category-map', mp],
    queryFn: () => api.get<{ map: Record<string, string>; builtIn: Record<string, string> }>(`/api/settings/category-map/${mp}`),
    enabled: !!mp,
  });

export const useLogs = (filters: LogFilters) =>
  useInfiniteQuery({
    queryKey: ['logs', filters],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      (await api.get<{ items: LogEntry[] }>(`/api/logs${qs({
        level: filters.level, marketplaceId: filters.marketplaceId, q: filters.q, listingId: filters.listingId, jobId: filters.jobId,
        limit: '100', before: pageParam ? String(pageParam) : undefined,
      })}`)).items,
    getNextPageParam: (last) => (last.length >= 100 ? last[last.length - 1]?.id : undefined),
  });

export const usePreview = (id: string | undefined, mp: MarketplaceId) =>
  useQuery({
    queryKey: ['preview', id, mp],
    queryFn: () => api.get<{ title: string; titleTruncated: boolean; description: string; priceCents: number | null; photoCount: number; mapping: Array<{ label: string; value: string }> }>(`/api/listings/${id}/marketplaces/${mp}/preview`),
    enabled: !!id && id !== 'new',
  });

// ---------------------------------------------------------------- mutations
function useApiMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, invalidate: (qc: QueryClient, args: TArgs, result: TResult) => void = () => {}, opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => invalidate(qc, args, result),
    onError: (err) => { if (!opts.silent) toast.error(err instanceof ApiError ? err.message : String(err)); },
  });
}

const refreshListing = (qc: QueryClient, id: string) => {
  void qc.invalidateQueries({ queryKey: ['listing', id] });
  void qc.invalidateQueries({ queryKey: ['listings'] });
  void qc.invalidateQueries({ queryKey: ['validation', id] });
  void qc.invalidateQueries({ queryKey: ['jobs'] });
};

export const useCreateListing = () =>
  useApiMutation((body: ListingPatch) => api.post<ListingDetail>('/api/listings', body), (qc, _a, r) => { qc.setQueryData(['listing', r.id], r); void qc.invalidateQueries({ queryKey: ['listings'] }); }, { silent: true });

export const usePatchListing = () =>
  useApiMutation(({ id, patch }: { id: string; patch: ListingPatch }) => api.patch<ListingDetail>(`/api/listings/${id}`, patch), (qc, a, r) => {
    qc.setQueryData(['listing', a.id], r);
    void qc.invalidateQueries({ queryKey: ['listings'] });
    void qc.invalidateQueries({ queryKey: ['validation', a.id] });
    void qc.invalidateQueries({ queryKey: ['recent'] });
  }, { silent: true });

export const useDeleteListing = () =>
  useApiMutation(({ id, force }: { id: string; force?: boolean }) => api.del(`/api/listings/${id}${force ? '?force=1' : ''}`), (qc) => { void qc.invalidateQueries({ queryKey: ['listings'] }); }, { silent: true });

export const useDuplicateListing = () =>
  useApiMutation((id: string) => api.post<ListingDetail>(`/api/listings/${id}/duplicate`), (qc) => { void qc.invalidateQueries({ queryKey: ['listings'] }); });

export const useArchive = () =>
  useApiMutation(({ id, archive }: { id: string; archive: boolean }) => api.post<ListingDetail>(`/api/listings/${id}/${archive ? 'archive' : 'unarchive'}`), (qc, a) => refreshListing(qc, a.id));

export const useUploadPhotos = () =>
  useApiMutation(({ id, files }: { id: string; files: File[] }) => api.upload<UploadResponse>(`/api/listings/${id}/photos`, files), (qc, a) => refreshListing(qc, a.id));

export const useReorderPhotos = () =>
  useApiMutation(({ id, photoIds }: { id: string; photoIds: string[] }) => api.patch<Photo[]>(`/api/listings/${id}/photos/order`, { photoIds }), (qc, a) => refreshListing(qc, a.id));

export const useEditPhoto = () =>
  useApiMutation(({ photoId, body }: { listingId: string; photoId: string; body: { rotation?: number; crop?: { x: number; y: number; width: number; height: number } | null } }) => api.patch<Photo>(`/api/photos/${photoId}`, body), (qc, a) => refreshListing(qc, a.listingId));

export const useDeletePhoto = () =>
  useApiMutation(({ photoId }: { listingId: string; photoId: string }) => api.del(`/api/photos/${photoId}`), (qc, a) => refreshListing(qc, a.listingId));

export const useSetTargets = () =>
  useApiMutation(({ id, marketplaceIds }: { id: string; marketplaceIds: MarketplaceId[] }) => api.put<ListingDetail>(`/api/listings/${id}/marketplaces`, { marketplaceIds }), (qc, a, r) => {
    qc.setQueryData(['listing', a.id], r);
    void qc.invalidateQueries({ queryKey: ['validation', a.id] });
    void qc.invalidateQueries({ queryKey: ['recent'] });
    void qc.invalidateQueries({ queryKey: ['listings'] });
  });

export const usePatchTarget = () =>
  useApiMutation(({ id, mp, patch }: { id: string; mp: MarketplaceId; patch: MarketplaceListingPatch }) => api.patch<MarketplaceListing>(`/api/listings/${id}/marketplaces/${mp}`, patch), (qc, a) => {
    refreshListing(qc, a.id);
    void qc.invalidateQueries({ queryKey: ['preview', a.id, a.mp] });
  });

export const useRemoveTarget = () =>
  useApiMutation(({ id, mp }: { id: string; mp: MarketplaceId }) => api.del(`/api/listings/${id}/marketplaces/${mp}`), (qc, a) => refreshListing(qc, a.id));

export const useCrosslist = () =>
  useApiMutation(({ id, marketplaceIds }: { id: string; marketplaceIds: MarketplaceId[] }) => api.post<CrosslistResponse>(`/api/listings/${id}/crosslist`, { marketplaceIds }), (qc, a) => refreshListing(qc, a.id), { silent: true });

export const useMarkListed = () =>
  useApiMutation(({ id, mp, url }: { id: string; mp: MarketplaceId; url?: string | null }) => api.post<MarketplaceListing>(`/api/listings/${id}/marketplaces/${mp}/mark-listed`, { url: url || null }), (qc, a) => refreshListing(qc, a.id));

export const useMarkEnded = () =>
  useApiMutation(({ id, mp }: { id: string; mp: MarketplaceId }) => api.post<MarketplaceListing>(`/api/listings/${id}/marketplaces/${mp}/mark-ended`), (qc, a) => refreshListing(qc, a.id));

export const useDeactivate = () =>
  useApiMutation(({ id, mp }: { id: string; mp: MarketplaceId }) => api.post<{ job: Job }>(`/api/listings/${id}/marketplaces/${mp}/deactivate`), (qc, a) => refreshListing(qc, a.id));

export const useDeactivateAll = () =>
  useApiMutation(({ id, marketplaceIds }: { id: string; marketplaceIds: MarketplaceId[] }) => api.post<{ jobs: Job[] }>(`/api/listings/${id}/deactivate-all`, { marketplaceIds }), (qc, a) => refreshListing(qc, a.id));

export const useMarkSold = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: { marketplaceId: MarketplaceId | 'elsewhere'; soldPriceCents?: number | null; soldAt?: string; deactivateMarketplaceIds: MarketplaceId[] } }) =>
      api.post<{ listing: ListingDetail; jobs: Job[] }>(`/api/listings/${id}/mark-sold`, body),
    (qc, a) => refreshListing(qc, a.id),
  );

export const useUnmarkSold = () =>
  useApiMutation((id: string) => api.post<ListingDetail>(`/api/listings/${id}/unmark-sold`), (qc, id) => refreshListing(qc, id));

export const useDismissSale = () =>
  useApiMutation((id: string) => api.post<ListingDetail>(`/api/listings/${id}/dismiss-sale`), (qc, id) => refreshListing(qc, id));

export const useUpdateRemote = () =>
  useApiMutation(({ id, mp }: { id: string; mp: MarketplaceId }) => api.post<{ job: Job }>(`/api/listings/${id}/marketplaces/${mp}/update`), (qc, a) => refreshListing(qc, a.id));

export const useOpenPhotos = () =>
  useApiMutation(({ id, mp }: { id: string; mp: MarketplaceId }) => api.post<{ path: string }>(`/api/listings/${id}/marketplaces/${mp}/open-photos`));

export const useJobContinue = () =>
  useApiMutation(({ id, url }: { id: string; url?: string | null }) => api.post<Job>(`/api/jobs/${id}/continue`, { url: url || null }), (qc) => { void qc.invalidateQueries({ queryKey: ['jobs'] }); });

export const useJobCancel = () =>
  useApiMutation((id: string) => api.post<Job>(`/api/jobs/${id}/cancel`), (qc) => { void qc.invalidateQueries({ queryKey: ['jobs'] }); });

export const useJobRetry = () =>
  useApiMutation((id: string) => api.post<Job>(`/api/jobs/${id}/retry`), (qc) => { void qc.invalidateQueries({ queryKey: ['jobs'] }); void qc.invalidateQueries({ queryKey: ['listings'] }); });

export const useConnect = () =>
  useApiMutation((mp: MarketplaceId) => api.post<{ job: Job }>(`/api/marketplaces/${mp}/connect`), (qc) => { void qc.invalidateQueries({ queryKey: ['jobs'] }); });

export const useDisconnect = () =>
  useApiMutation((mp: MarketplaceId) => api.post<MarketplaceInfo>(`/api/marketplaces/${mp}/disconnect`), (qc) => { void qc.invalidateQueries({ queryKey: ['marketplaces'] }); });

export const useSaveSettings = () =>
  useApiMutation((s: Settings) => api.put<Settings>('/api/settings', s), (qc, _a, r) => { qc.setQueryData(['settings'], r); void qc.invalidateQueries({ queryKey: ['marketplaces'] }); });

export const useSaveCategoryMap = () =>
  useApiMutation(({ mp, map }: { mp: MarketplaceId; map: Record<string, string> }) => api.put<{ map: Record<string, string> }>(`/api/settings/category-map/${mp}`, { map }), (qc, a) => { void qc.invalidateQueries({ queryKey: ['category-map', a.mp] }); });
