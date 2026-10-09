import { useRef } from 'react';
import clsx from 'clsx';
import { CONDITIONS, CONDITION_HINTS, CONDITION_LABELS, type Condition } from '../../../shared/constants';

export function ConditionPicker({ id, value, onChange }: { id?: string; value: Condition | null; onChange: (c: Condition) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (i: number) => {
    const next = (i + CONDITIONS.length) % CONDITIONS.length;
    refs.current[next]?.focus();
    onChange(CONDITIONS[next]!);
  };
  return (
    <div id={id} role="radiogroup" aria-label="Condition" className="flex flex-wrap gap-1.5"
      onKeyDown={(e) => {
        if (/^[1-6]$/.test(e.key)) { e.preventDefault(); onChange(CONDITIONS[Number(e.key) - 1]!); }
      }}>
      {CONDITIONS.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={CONDITION_HINTS[c]}
          ref={(el) => { refs.current[i] = el; }}
          tabIndex={value === c || (value === null && i === 0) ? 0 : -1}
          className={clsx('h-10 rounded-lg border px-3 text-sm font-medium', value === c ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50')}
          onClick={() => onChange(c)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}>
          {CONDITION_LABELS[c]}
        </button>
      ))}
    </div>
  );
}
