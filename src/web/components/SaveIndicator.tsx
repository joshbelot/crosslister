import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { SaveState } from '../lib/useListingDraft';

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return <span className="text-sm text-zinc-400" data-testid="save-indicator"> </span>;
  if (state === 'saving') return <span className="inline-flex items-center gap-1.5 text-sm text-zinc-500" data-testid="save-indicator"><Loader2 size={14} className="animate-spin" /> Saving…</span>;
  if (state === 'saved') return <span className="inline-flex items-center gap-1.5 text-sm text-green-600" data-testid="save-indicator"><Check size={14} /> Saved</span>;
  return <span className="inline-flex items-center gap-1.5 text-sm text-amber-600" data-testid="save-indicator"><AlertTriangle size={14} /> Couldn't save — retrying</span>;
}
