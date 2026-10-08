import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { CATEGORIES, categoryPathLabel } from '../../../shared/taxonomy';
import { normalizeText } from '../../../shared/text';
import { useRecent } from '../../api/hooks';

const ALL = CATEGORIES.filter((c) => c.selectable).map((c) => ({ id: c.id, label: categoryPathLabel(c.id), norm: normalizeText(categoryPathLabel(c.id)) }));

export function CategoryPicker({ id, value, onChange, onPicked }: { id?: string; value: string | null; onChange: (id: string) => void; onPicked?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const recent = useRecent().data?.recentCategories ?? [];
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const tokens = normalizeText(q).split(' ').filter(Boolean);
    const match = (norm: string) => tokens.every((t) => norm.includes(t));
    const recentRows = tokens.length === 0
      ? recent.flatMap((rid) => { const r = ALL.find((a) => a.id === rid); return r ? [{ ...r, group: 'Recent' }] : []; })
      : [];
    const rest = ALL.filter((a) => match(a.norm)).map((a) => ({ ...a, group: 'All categories' }));
    return [...recentRows, ...rest];
  }, [q, recent]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (cid: string) => { onChange(cid); setOpen(false); setQ(''); setTimeout(() => onPicked?.(), 0); };

  return (
    <div ref={boxRef} className="relative">
      <button id={id} type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={clsx('truncate', !value && 'text-zinc-400')}>{value ? categoryPathLabel(value) : 'Choose category'}</span>
        <ChevronDown size={16} className="shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[320px] rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="border-b border-zinc-100 p-2">
            <input ref={searchRef} className="input h-9" placeholder="Search categories…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) choose(r.id); }
                else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
              }} />
          </div>
          <ul className="max-h-72 overflow-auto py-1" role="listbox">
            {rows.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">No matching category.</li>}
            {rows.map((r, i) => (
              <li key={`${r.group}-${r.id}`} role="option" aria-selected={i === active}>
                {(i === 0 || rows[i - 1]!.group !== r.group) && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{r.group}</div>}
                <div className={clsx('cursor-pointer px-3 py-1.5 text-sm', i === active && 'bg-indigo-50', r.id === value && 'font-medium')}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(r.id); }}>{r.label}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
