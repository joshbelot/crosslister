import { useState } from 'react';
import { X } from 'lucide-react';

export function TagsInput({ id, value, onChange, max = 20 }: { id?: string; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t || value.length >= max) { setText(''); return; }
    if (!value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t.slice(0, 40)]);
    setText('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-sm">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}><X size={12} /></button>
        </span>
      ))}
      <input id={id} className="min-w-24 flex-1 bg-transparent text-sm outline-none" value={text} placeholder={value.length ? '' : 'Type a tag, press Enter'}
        onChange={(e) => { if (e.target.value.includes(',')) { e.target.value.split(',').forEach((p, i, a) => { if (i < a.length - 1) add(p); else setText(p); }); } else setText(e.target.value); }}
        onBlur={() => add(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          else if (e.key === 'Backspace' && text === '' && value.length) onChange(value.slice(0, -1));
        }} />
    </div>
  );
}
