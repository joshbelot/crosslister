import { Check } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { COLORS, MAX_COLORS, type ColorId } from '../../../shared/colors';

export function ColorPicker({ id, value, onChange }: { id?: string; value: ColorId[]; onChange: (v: ColorId[]) => void }) {
  const toggle = (c: ColorId) => {
    if (value.includes(c)) return onChange(value.filter((x) => x !== c));
    if (value.length >= MAX_COLORS) { toast(`Pick up to ${MAX_COLORS} colors`); return; }
    onChange([...value, c]);
  };
  return (
    <div id={id} className="flex flex-wrap gap-1.5" role="group" aria-label="Color">
      {COLORS.map((c) => {
        const on = value.includes(c.id);
        return (
          <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on} title={c.label}
            className={clsx('flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs', on ? 'border-indigo-600 bg-indigo-50 font-medium' : 'border-zinc-300 bg-white hover:bg-zinc-50')}>
            <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300"
              style={{ background: c.hex === 'conic-gradient' ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : c.hex }}>
              {on && <Check size={12} className={c.id === 'white' || c.id === 'cream' || c.id === 'yellow' || c.id === 'beige' ? 'text-zinc-800' : 'text-white'} />}
            </span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
