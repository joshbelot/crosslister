import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useRecent } from '../../api/hooks';

export function BrandInput({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const brands = useRecent().data?.brands ?? [];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const starts = brands.filter((b) => b.toLowerCase().startsWith(q) && b.toLowerCase() !== q);
    const contains = brands.filter((b) => !b.toLowerCase().startsWith(q) && b.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [brands, value]);

  const pick = (b: string) => { onChange(b); setOpen(false); };

  return (
    <div className="relative">
      <input id={id} className="input" value={value} autoComplete="off" placeholder="e.g. Nike"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(suggestions.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Tab' || e.key === 'Enter') { const s = suggestions[active]; if (s) { if (e.key === 'Enter') e.preventDefault(); pick(s); } }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s} role="option" aria-selected={i === active} className={clsx('cursor-pointer px-3 py-1.5 text-sm', i === active && 'bg-indigo-50')}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
