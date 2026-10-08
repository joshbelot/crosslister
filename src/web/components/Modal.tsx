import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('card flex max-h-[90vh] w-full flex-col', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
