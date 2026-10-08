import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ACCEPTED_IMAGE_EXTENSIONS, MAX_PHOTOS_PER_LISTING } from '../../../shared/constants';
import type { Photo } from '../../../shared/types';
import { useDeletePhoto, useEditPhoto, useReorderPhotos, useUploadPhotos } from '../../api/hooks';
import { useHotkeys } from '../../lib/keyboard';
import { CropModal } from './CropModal';
import { Lightbox } from './Lightbox';
import { PhotoTile } from './PhotoTile';

export interface PhotoManagerHandle { open(): void }

const ACCEPT = {
  'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/heic': ['.heic'], 'image/heif': ['.heif'],
};
const isImageFile = (f: File) => ACCEPTED_IMAGE_EXTENSIONS.some((e) => f.name.toLowerCase().endsWith(e)) || f.type.startsWith('image/');

export const PhotoManager = forwardRef<PhotoManagerHandle, {
  listingId: string | null; photos: Photo[]; ensureCreated: () => Promise<string>; onUploaded?: (count: number) => void;
}>(function PhotoManager({ listingId, photos, ensureCreated, onUploaded }, ref) {
  const upload = useUploadPhotos();
  const reorder = useReorderPhotos();
  const edit = useEditPhoto();
  const del = useDeletePhoto();
  const [pending, setPending] = useState(0);
  const [order, setOrder] = useState<string[] | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => { setOrder(null); }, [photos]);
  const sorted = useMemo(() => {
    if (!order) return photos;
    const byId = new Map(photos.map((p) => [p.id, p]));
    const list = order.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
    return list.length === photos.length ? list : photos;
  }, [photos, order]);

  const handleFiles = useCallback(async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (images.length === 0) { if (files.length) toast.error('Those files are not photos. Use JPG, PNG, WEBP or HEIC.'); return; }
    setPending((n) => n + images.length);
    try {
      const id = listingId ?? (await ensureCreated());
      const res = await upload.mutateAsync({ id, files: images });
      res.errors.forEach((e) => toast.error(e));
      res.notes.forEach((n) => toast.info(n));
      onUploaded?.(res.photos.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setPending((n) => Math.max(0, n - images.length));
    }
  }, [listingId, ensureCreated, upload, onUploaded]);

  const { getRootProps, getInputProps, open } = useDropzone({ accept: ACCEPT, noDrag: true, noKeyboard: true, onDrop: (accepted) => { void handleFiles(accepted); } });
  useImperativeHandle(ref, () => ({ open }), [open]);
  useHotkeys({ 'mod+o': () => open() });

  // Whole-page drop and paste.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current++; setDragOver(true); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth.current = 0; setDragOver(false);
      void handleFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void handleFiles(files); }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('paste', paste);
    };
  }, [handleFiles]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const applyOrder = (ids: string[]) => {
    if (!listingId) return;
    const previous = order;
    setOrder(ids);
    reorder.mutate({ id: listingId, photoIds: ids }, { onError: () => setOrder(previous) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = sorted.map((p) => p.id);
    applyOrder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  const makeCover = (p: Photo) => applyOrder([p.id, ...sorted.map((x) => x.id).filter((id) => id !== p.id)]);
  const rotate = (p: Photo) => edit.mutate({ listingId: p.listingId, photoId: p.id, body: { rotation: (p.rotation + 90) % 360 } });
  const remove = (p: Photo) => del.mutate({ listingId: p.listingId, photoId: p.id });

  const total = sorted.length + pending;
  const cropPhoto = cropping ? photos.find((p) => p.id === cropping) : undefined;

  return (
    <section aria-label="Photos" id="field-photos">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700">Photos</h2>
        <span className="text-xs text-zinc-500">{sorted.length} / {MAX_PHOTOS_PER_LISTING}</span>
      </div>
      <div {...getRootProps()} className="contents"><input {...getInputProps()} data-testid="photo-input" /></div>

      {total === 0 ? (
        <button type="button" onClick={open} data-testid="dropzone"
          className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-white text-zinc-500 hover:border-indigo-400 hover:text-indigo-600">
          <Upload size={28} />
          <span className="text-base font-medium">Drop photos here</span>
          <span className="text-sm">or click to choose · <span className="kbd">⌘O</span></span>
        </button>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-5 gap-3">
              {sorted.map((p, i) => (
                <PhotoTile key={p.id} photo={p} isCover={i === 0} onOpen={() => setLightbox(i)} onRotate={() => rotate(p)}
                  onCrop={() => setCropping(p.id)} onMakeCover={() => makeCover(p)} onDelete={() => remove(p)} />
              ))}
              {Array.from({ length: pending }).map((_, i) => (
                <div key={`pending-${i}`} className="flex aspect-square items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-400" data-testid="photo-pending">
                  <Loader2 className="animate-spin" size={22} />
                </div>
              ))}
              {total < MAX_PHOTOS_PER_LISTING && (
                <button type="button" onClick={open} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-indigo-400 hover:text-indigo-600">
                  <ImagePlus size={22} /> Add photos
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-indigo-600/20 backdrop-blur-[1px]">
          <div className="rounded-2xl border-4 border-dashed border-indigo-500 bg-white px-10 py-8 text-xl font-semibold text-indigo-700">Drop to add photos</div>
        </div>
      )}
      {lightbox !== null && (
        <Lightbox photos={sorted} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} onRotate={rotate}
          onCrop={(p) => { setLightbox(null); setCropping(p.id); }} onMakeCover={makeCover}
          onDelete={(p) => { if (window.confirm('Delete this photo?')) remove(p); }} />
      )}
      {cropPhoto && <CropModal photo={cropPhoto} onClose={() => setCropping(null)} />}
    </section>
  );
});
