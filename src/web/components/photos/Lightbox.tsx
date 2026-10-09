import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Crop, RotateCw, Star, Trash2, X } from 'lucide-react';
import type { Photo } from '../../../shared/types';

export function Lightbox({ photos, index, onIndex, onClose, onRotate, onCrop, onMakeCover, onDelete }: {
  photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  onRotate: (p: Photo) => void; onCrop: (p: Photo) => void; onMakeCover: (p: Photo) => void; onDelete: (p: Photo) => void;
}) {
  const photo = photos[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') onIndex(Math.min(photos.length - 1, index + 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, photos.length, onClose, onIndex]);
  useEffect(() => { if (!photo) onClose(); }, [photo, onClose]);
  if (!photo) return null;
  const btn = 'rounded-full bg-white/10 p-2 text-white hover:bg-white/20';
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm">{index + 1} / {photos.length}</span>
        <div className="flex gap-2">
          <button className={btn} title="Make cover" aria-label="Make cover" onClick={() => onMakeCover(photo)}><Star size={18} /></button>
          <button className={btn} title="Rotate" aria-label="Rotate" onClick={() => onRotate(photo)}><RotateCw size={18} /></button>
          <button className={btn} title="Crop" aria-label="Crop" onClick={() => onCrop(photo)}><Crop size={18} /></button>
          <button className={btn} title="Delete" aria-label="Delete" onClick={() => onDelete(photo)}><Trash2 size={18} /></button>
          <button className={btn} title="Close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {index > 0 && <button className={`${btn} absolute left-4`} aria-label="Previous" onClick={() => onIndex(index - 1)}><ChevronLeft size={24} /></button>}
        <img src={photo.urls.display} alt="" className="max-h-full max-w-full object-contain" />
        {index < photos.length - 1 && <button className={`${btn} absolute right-4`} aria-label="Next" onClick={() => onIndex(index + 1)}><ChevronRight size={24} /></button>}
      </div>
    </div>
  );
}
