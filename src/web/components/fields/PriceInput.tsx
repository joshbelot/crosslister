import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { parsePriceToCents } from '../../lib/format';

const show = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

export function PriceInput({ id, value, onChange, placeholder, helpHidden }: {
  id?: string; value: number | null; onChange: (cents: number | null) => void; placeholder?: string; helpHidden?: boolean;
}) {
  const [text, setText] = useState(show(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  useEffect(() => { if (!focused.current) { setText(show(value)); setInvalid(false); } }, [value]);

  const commit = (raw: string, normalize: boolean) => {
    if (raw.trim() === '') { setInvalid(false); onChange(null); if (normalize) setText(''); return; }
    const cents = parsePriceToCents(raw);
    if (cents === null) { if (normalize) setInvalid(true); return; }
    setInvalid(false);
    onChange(cents);
    if (normalize) setText(show(cents));
  };

  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-zinc-500">$</span>
        <input id={id} inputMode="decimal" className={clsx('input pl-7', invalid && 'input-error')} value={text} placeholder={placeholder ?? '0.00'}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => { setText(e.target.value); commit(e.target.value, false); }}
          onBlur={() => { focused.current = false; commit(text, true); }} />
      </div>
      {invalid && !helpHidden && <p className="error-text">Enter a price like 65 or 65.50</p>}
    </div>
  );
}
