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
