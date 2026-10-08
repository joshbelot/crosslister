import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Crop, RotateCw, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '../../../shared/types';

export function PhotoTile({ photo, isCover, onOpen, onRotate, onCrop, onMakeCover, onDelete }: {
  photo: Photo; isCover: boolean; onOpen: () => void; onRotate: () => void; onCrop: () => void; onMakeCover: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });
  const [confirming, setConfirming] = useState(false);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const tool = 'rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80';
  return (
    <div ref={setNodeRef} data-testid="photo-tile" {...attributes} {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('group relative aspect-square cursor-grab overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100', isDragging && 'z-10 opacity-70 shadow-lg')}
      onClick={onOpen}>
      <img src={photo.urls.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
      {isCover && <span className="absolute left-1.5 top-1.5 rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] font-medium text-white">Cover</span>}
      {confirming ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white" onClick={(e) => e.stopPropagation()}>
          <span className="text-sm">Delete photo?</span>
          <div className="flex gap-2">
            <button className="btn btn-danger btn-sm" onClick={stop(onDelete)}>Yes</button>
            <button className="btn btn-secondary btn-sm" onClick={stop(() => setConfirming(false))}>No</button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isCover && <button className={tool} title="Make cover" aria-label="Make cover" onClick={stop(onMakeCover)}><Star size={14} /></button>}
          <button className={tool} title="Rotate" aria-label="Rotate" onClick={stop(onRotate)}><RotateCw size={14} /></button>
          <button className={tool} title="Crop" aria-label="Crop" onClick={stop(onCrop)}><Crop size={14} /></button>
          <button className={tool} title="Delete" aria-label="Delete" onClick={stop(() => setConfirming(true))}><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}
