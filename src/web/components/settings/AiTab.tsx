import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { Toggle } from './Toggle';
import type { SettingsDraft } from './useSettingsDraft';

type Provider = 'ollama' | 'openai_compatible' | 'anthropic';
const DEFAULTS: Record<Provider, { baseUrl: string; textModel: string; visionModel: string }> = {
  ollama: { baseUrl: 'http://127.0.0.1:11434', textModel: 'gemma3:4b', visionModel: 'gemma3:4b' },
  openai_compatible: { baseUrl: 'http://127.0.0.1:1234/v1', textModel: '', visionModel: '' },
  anthropic: { baseUrl: '', textModel: '', visionModel: '' },
};
const LABELS: Record<Provider, string> = { ollama: 'Ollama (local, free)', openai_compatible: 'OpenAI-compatible server (e.g. LM Studio)', anthropic: 'Anthropic (paid API)' };

export function AiTab({ s }: { s: SettingsDraft }) {
  const ai = s.draft!.ai;
  const [result, setResult] = useState<{ ok: boolean; message: string; models?: string[] } | null>(null);
  const test = useMutation({
    mutationFn: () => api.get<{ ok: boolean; message: string; models?: string[] }>('/api/ai/health'),
    onSuccess: setResult,
    onError: (e: ApiError) => setResult({ ok: false, message: e.message }),
  });
  const set = (patch: Partial<typeof ai>) => s.update((x) => { Object.assign(x.ai, patch); return x; });
  const placeholder = ai.provider === 'anthropic' ? 'Enter an Anthropic model name' : 'Model name';

  return (
    <div className="max-w-2xl space-y-4">
      <section className="card space-y-4 p-4">
        <label className="flex items-center gap-3 text-sm">
          <Toggle checked={ai.enabled} label="Turn on AI suggestions" onChange={(v) => set({ enabled: v })} /> Turn on AI suggestions (optional)
        </label>
        <p className="help">Suggestions are always shown for you to review. Nothing is applied until you click Use, and the app works fully without AI.</p>
        <div>
          <label className="label" htmlFor="ai-provider">Provider</label>
          <select id="ai-provider" className="input" value={ai.provider} disabled={!ai.enabled}
            onChange={(e) => { const p = e.target.value as Provider; set({ provider: p, ...DEFAULTS[p] }); setResult(null); }}>
            {(Object.keys(LABELS) as Provider[]).map((p) => <option key={p} value={p}>{LABELS[p]}</option>)}
          </select>
          {ai.provider === 'anthropic' && <p className="mt-1 text-xs text-amber-700">Uses a paid API. Set ANTHROPIC_API_KEY in your .env file.</p>}
          {ai.provider === 'openai_compatible' && <p className="help mt-1">If your server needs a key, set OPENAI_COMPATIBLE_API_KEY in your .env file.</p>}
        </div>
        {ai.provider !== 'anthropic' && (
          <div><label className="label" htmlFor="ai-url">Server address</label>
            <input id="ai-url" className="input" disabled={!ai.enabled} value={ai.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ai-text">Text model</label>
            <input id="ai-text" className="input" disabled={!ai.enabled} placeholder={placeholder} value={ai.textModel} onChange={(e) => set({ textModel: e.target.value })} /></div>
          <div><label className="label" htmlFor="ai-vision">Photo model</label>
            <input id="ai-vision" className="input" disabled={!ai.enabled} placeholder={placeholder} value={ai.visionModel} onChange={(e) => set({ visionModel: e.target.value })} /></div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-secondary" disabled={!ai.enabled || s.dirty || test.isPending} onClick={() => test.mutate()}>
            {test.isPending && <Loader2 className="animate-spin" size={16} />} Test connection
          </button>
          {s.dirty && <span className="help">Save your changes first.</span>}
        </div>
        {result && <p className={result.ok ? 'text-sm text-green-700' : 'error-text'}>{result.message}</p>}
      </section>
    </div>
  );
}
