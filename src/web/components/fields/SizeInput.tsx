import { SIZE_PRESETS } from '../../../shared/sizes';
import { sizeTypeOf } from '../../../shared/taxonomy';
import clsx from 'clsx';

export function SizeInput({ id, value, categoryId, onChange }: { id?: string; value: string; categoryId: string | null; onChange: (v: string) => void }) {
  const type = sizeTypeOf(categoryId);
  const presets = SIZE_PRESETS[type];
  const none = type === 'none' && categoryId !== null;
  return (
    <div>
      <input id={id} className="input" value={none ? '' : value} disabled={none} placeholder={none ? 'Not needed' : 'e.g. M or 10.5'} onChange={(e) => onChange(e.target.value)} />
      {presets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)}
              className={clsx('rounded-md border px-2 py-0.5 text-xs', value === p ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50')}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
