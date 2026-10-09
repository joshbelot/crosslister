import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { MarketplaceId } from '../../shared/constants';
import { api, ApiError } from '../api/client';
import { useSettings } from '../api/hooks';

export const useAiEnabled = () => useSettings().data?.ai.enabled ?? false;

/** ✨ button + popover. `load` fetches suggestions; `children` renders them with Use buttons. */
function AiPopover<T>({ label, load, children }: { label: string; load: () => Promise<T>; children: (data: T, close: () => void) => React.ReactNode }) {
  const [state, setState] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }>({ status: 'idle' });
  const close = () => setState({ status: 'idle' });
  const run = async () => {
    setState({ status: 'loading' });
    try { setState({ status: 'ready', data: await load() }); } catch (e) { setState({ status: 'error', message: e instanceof ApiError ? e.message : String(e) }); }
  };
  return (
    <span className="relative">
      <button type="button" className="mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50" aria-label={label} title={label}
        disabled={state.status === 'loading'} onClick={() => void run()}>
        {state.status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Suggest
      </button>
      {state.status !== 'idle' && state.status !== 'loading' && (
        <div className="absolute right-0 z-30 mt-1 w-96 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg" role="dialog" aria-label={label}>
          {state.status === 'error' ? <p className="error-text">{state.message}</p> : children(state.data, close)}
          <div className="mt-2 text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={close}>Dismiss</button></div>
        </div>
      )}
    </span>
  );
}

export function AiDescriptionButton({ ensureId, onUse }: { ensureId: () => Promise<string>; onUse: (text: string, mode: 'replace' | 'append') => void }) {
  if (!useAiEnabled()) return null;
  return (
    <AiPopover label="Suggest a description with AI" load={async () => api.post<{ description: string }>('/api/ai/description', { listingId: await ensureId() })}>
      {(d, close) => (
        <>
          <p className="max-h-60 overflow-auto whitespace-pre-wrap">{d.description}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { onUse(d.description, 'replace'); close(); }}>Use</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onUse(d.description, 'append'); close(); }}>Append</button>
          </div>
        </>
      )}
    </AiPopover>
  );
}

export function AiTitleButton({ ensureId, marketplaceIds, onUse }: { ensureId: () => Promise<string>; marketplaceIds: MarketplaceId[]; onUse: (title: string) => void }) {
  if (!useAiEnabled()) return null;
  return (
    <AiPopover label="Suggest titles with AI" load={async () => api.post<{ titles: string[]; maxLen: number }>('/api/ai/titles', { listingId: await ensureId(), marketplaceIds })}>
      {(d, close) => d.titles.length === 0 ? <p>No suggestions fit. Add more details (brand, category, size) and try again.</p> : (
        <ul className="space-y-2">
          {d.titles.map((t) => (
            <li key={t} className="flex items-center justify-between gap-2">
              <span>{t} <span className="text-xs text-zinc-400">{t.length}/{d.maxLen}</span></span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { onUse(t); close(); }}>Use</button>
            </li>
          ))}
        </ul>
      )}
    </AiPopover>
  );
}

interface AttributeSuggestion {
  brand: string | null; categoryId: string | null; colors: string[]; size: string | null; itemType: string | null;
  evidence: { brand?: string; size?: string };
}
export interface AttributeApply { brand?: string; categoryId?: string; colors?: string[]; size?: string }

/** "Suggest from photos" (09 §4.3): shows each value with its evidence; nothing is filled until the user applies the checked ones. */
export function AiAttributesCard({ ensureId, photoCount, onApply }: { ensureId: () => Promise<string>; photoCount: number; onApply: (v: AttributeApply) => void }) {
  const enabled = useAiEnabled();
  const [state, setState] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AttributeSuggestion }>({ status: 'idle' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  if (!enabled || photoCount === 0) return null;

  const run = async () => {
    setState({ status: 'loading' });
    try {
      const data = await api.post<AttributeSuggestion>('/api/ai/attributes', { listingId: await ensureId() });
      setPicked({ brand: true, categoryId: true, colors: true, size: true });
      setState({ status: 'ready', data });
    } catch (e) { setState({ status: 'error', message: e instanceof ApiError ? e.message : String(e) }); }
  };
  const rows = state.status === 'ready' ? ([
    ['brand', 'Brand', state.data.brand, state.data.evidence.brand],
    ['categoryId', 'Category', state.data.categoryId, state.data.itemType ?? undefined],
    ['colors', 'Colors', state.data.colors.length ? state.data.colors.join(', ') : null, undefined],
    ['size', 'Size', state.data.size, state.data.evidence.size],
  ] as const).filter((r) => r[2]) : [];

  return (
    <div className="mt-3">
      <button type="button" className="btn btn-secondary btn-sm" disabled={state.status === 'loading'} onClick={() => void run()}>
        {state.status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Suggest from photos
      </button>
      {state.status === 'error' && <p className="error-text mt-2">{state.message}</p>}
      {state.status === 'ready' && (
        <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          {rows.length === 0 ? <p>Nothing could be read clearly from the photos.</p> : (
            <ul className="space-y-1">
              {rows.map(([key, label, value, evidence]) => (
                <li key={key}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={picked[key] ?? false} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.checked }))} />
                    <span><span className="font-medium">{label}:</span> {value}{evidence && <span className="text-xs text-zinc-500"> — {evidence}</span>}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={rows.length === 0 || !rows.some(([k]) => picked[k])}
              onClick={() => {
                const d = state.data;
                onApply({
                  ...(picked.brand && d.brand ? { brand: d.brand } : {}), ...(picked.categoryId && d.categoryId ? { categoryId: d.categoryId } : {}),
                  ...(picked.colors && d.colors.length ? { colors: d.colors } : {}), ...(picked.size && d.size ? { size: d.size } : {}),
                });
                setState({ status: 'idle' });
              }}>Apply selected</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setState({ status: 'idle' })}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}
