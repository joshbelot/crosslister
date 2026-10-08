import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../api/client';

export interface EbayAspect { name: string; required: boolean; mode: 'FREE_TEXT' | 'SELECTION_ONLY'; multi: boolean; values: string[] }
type Commit = (patch: Record<string, unknown>) => void;

export function EbayCategoryField({ data, onCommitMany }: { data: Record<string, unknown>; onCommitMany: Commit }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const results = useQuery({
    queryKey: ['ebay', 'suggest', debounced],
    queryFn: () => api.get<Array<{ categoryId: string; name: string; path: string }>>(`/api/marketplaces/ebay/categories/suggest?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const choose = async (c: { categoryId: string; path: string }) => {
    let required: string[] = [];
    try {
      required = (await api.get<EbayAspect[]>(`/api/marketplaces/ebay/aspects?categoryId=${c.categoryId}`)).filter((a) => a.required).map((a) => a.name);
    } catch { /* aspects are re-checked at publish time */ }
    onCommitMany({ categoryId: c.categoryId, categoryName: c.path, categoryAuto: false, requiredAspects: required });
    setQ('');
  };
  return (
    <div>
      <div className="mb-2 text-sm">
        {data.categoryId
          ? <><span className="font-medium">{String(data.categoryName ?? data.categoryId)}</span> {data.categoryAuto !== false && <span className="pill ml-1 bg-sky-100 text-sky-700">auto</span>}</>
          : <span className="text-zinc-500">No category yet.</span>}
      </div>
      <input className="input" placeholder="Search eBay categories…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search eBay categories" />
      {results.isError && <p className="error-text">Couldn't search eBay. Is eBay connected and set up?</p>}
      {(results.data ?? []).length > 0 && (
        <ul className="mt-1 max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white text-sm">
          {results.data!.map((c) => (
            <li key={c.categoryId}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => void choose(c)}>{c.path}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AspectRow({ a, value, auto, onChange }: { a: EbayAspect; value: string[]; auto: string[] | undefined; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const listId = `aspect-${a.name.replace(/\W+/g, '-')}`;
  const placeholder = auto?.length ? `Auto: ${auto.join(', ')}` : '';
  const add = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (a.mode === 'SELECTION_ONLY' && !a.values.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    const canonical = a.values.find((x) => x.toLowerCase() === t.toLowerCase()) ?? t;
    onChange(a.multi ? [...new Set([...value, canonical])] : [canonical]);
    setText('');
  };
  return (
    <div>
      <label className="label" htmlFor={listId}>{a.name}{a.required && <span className="ml-0.5 text-red-600" title="Required">*</span>}</label>
      {a.multi && value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-sm">{v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><X size={12} /></button></span>
          ))}
        </div>
      )}
      {a.mode === 'SELECTION_ONLY' && !a.multi ? (
        <select id={listId} className="input" value={value[0] ?? ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
          <option value="">{placeholder || 'Choose…'}</option>
          {a.values.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : (
        <>
          <input id={listId} className="input" list={`${listId}-options`} placeholder={placeholder} value={a.multi ? text : (text || value[0] || '')}
            onChange={(e) => { setText(e.target.value); if (!a.multi && a.mode === 'FREE_TEXT') onChange(e.target.value ? [e.target.value] : []); }}
            onBlur={() => { if (a.multi || a.mode === 'SELECTION_ONLY') add(text); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} />
          <datalist id={`${listId}-options`}>{a.values.slice(0, 100).map((v) => <option key={v} value={v} />)}</datalist>
        </>
      )}
    </div>
  );
}

export function EbayAspectsField({ data, value, onCommit, listingId }: { data: Record<string, unknown>; value: unknown; onCommit: (v: unknown) => void; listingId: string }) {
  const categoryId = typeof data.categoryId === 'string' ? data.categoryId : '';
  const aspects = useQuery({ queryKey: ['ebay', 'aspects', categoryId], queryFn: () => api.get<EbayAspect[]>(`/api/marketplaces/ebay/aspects?categoryId=${categoryId}`), enabled: !!categoryId });
  const auto = useQuery({
    queryKey: ['ebay', 'auto-aspects', listingId, categoryId],
    queryFn: () => api.get<Record<string, string[]>>(`/api/marketplaces/ebay/auto-aspects?listingId=${listingId}&categoryId=${categoryId}`),
    enabled: !!categoryId,
  });
  const current = useMemo(() => (value && typeof value === 'object' ? (value as Record<string, string[]>) : {}), [value]);
  const [showMore, setShowMore] = useState(false);
  if (!categoryId) return <p className="help">Choose an eBay category first.</p>;
  if (aspects.isLoading) return <p className="help">Loading item specifics…</p>;
  if (aspects.isError) return <p className="error-text">Couldn't load item specifics from eBay.</p>;
  const all = aspects.data ?? [];
  const required = all.filter((a) => a.required);
  const optional = all.filter((a) => !a.required);
  const set = (name: string, v: string[]) => { const next = { ...current }; if (v.length) next[name] = v; else delete next[name]; onCommit(next); };
  return (
    <div className="space-y-3">
      {required.map((a) => <AspectRow key={a.name} a={a} value={current[a.name] ?? []} auto={auto.data?.[a.name]} onChange={(v) => set(a.name, v)} />)}
      {optional.length > 0 && (
        <>
          <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => setShowMore((s) => !s)}>{showMore ? 'Hide' : 'More'} item specifics ({optional.length})</button>
          {showMore && optional.map((a) => <AspectRow key={a.name} a={a} value={current[a.name] ?? []} auto={auto.data?.[a.name]} onChange={(v) => set(a.name, v)} />)}
        </>
      )}
    </div>
  );
}

export function EbayConditionField({ data, value, onCommit }: { data: Record<string, unknown>; value: unknown; onCommit: (v: unknown) => void }) {
  const categoryId = typeof data.categoryId === 'string' ? data.categoryId : '';
  const conditions = useQuery({
    queryKey: ['ebay', 'conditions', categoryId],
    queryFn: () => api.get<Array<{ conditionId: number; label: string }>>(`/api/marketplaces/ebay/conditions?categoryId=${categoryId}`),
    enabled: !!categoryId,
  });
  return (
    <select className="input" value={value === undefined ? '' : String(value)} onChange={(e) => onCommit(e.target.value ? Number(e.target.value) : undefined)} aria-label="eBay condition">
      <option value="">Automatic</option>
      {(conditions.data ?? []).map((c) => <option key={c.conditionId} value={c.conditionId}>{c.label}</option>)}
    </select>
  );
}
