import { useEffect, useRef } from 'react';

/**
 * Keys: 'n', '/', '?', 'mod+s', 'mod+enter', 'g i' (sequence), 'escape'.
 * Single-key shortcuts are ignored while typing in a form control; `mod+` combos always work.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      if (mod) {
        const combo = `mod+${key}`;
        const fn = ref.current[combo];
        if (fn) { e.preventDefault(); fn(e); }
        return;
      }
      if (e.altKey) return;
      if (typing && key !== 'escape') return;
      if (pending) {
        const seq = `${pending} ${key}`;
        pending = null;
        window.clearTimeout(timer);
        const fn = ref.current[seq];
        if (fn) { e.preventDefault(); fn(e); return; }
      }
      const prefixes = Object.keys(ref.current).filter((k) => k.includes(' ') && k.startsWith(`${key} `));
      if (prefixes.length) {
        pending = key;
        timer = window.setTimeout(() => { pending = null; }, 1000);
        return;
      }
      const fn = ref.current[key];
      if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer); };
  }, [enabled]);
}
