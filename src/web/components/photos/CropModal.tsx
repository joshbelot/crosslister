import { useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import clsx from 'clsx';
import type { Photo } from '../../../shared/types';
import { useEditPhoto } from '../../api/hooks';
import { Modal } from '../Modal';

export function CropModal({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const edit = useEditPhoto();
  const swapped = photo.rotation === 90 || photo.rotation === 270;
  const original = swapped ? photo.height / photo.width : photo.width / photo.height;
  const ASPECTS: Array<[string, number]> = [['Original', original], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4]];
  const [aspectIdx, setAspectIdx] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  const save = () => {
    if (!area) return;
    const clamp = (n: number) => Math.min(1, Math.max(0, n / 100));
    edit.mutate(
      { listingId: photo.listingId, photoId: photo.id, body: { crop: { x: clamp(area.x), y: clamp(area.y), width: Math.max(0.01, clamp(area.width)), height: Math.max(0.01, clamp(area.height)) } } },
      { onSuccess: onClose },
    );
  };
  const reset = () => edit.mutate({ listingId: photo.listingId, photoId: photo.id, body: { crop: null } }, { onSuccess: onClose });

  return (
    <Modal title="Crop photo" onClose={onClose} wide
      footer={<>
        <button className="btn btn-secondary mr-auto" onClick={reset} disabled={edit.isPending}>Reset</button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={edit.isPending || !area}>Save</button>
      </>}>
      <div className="relative h-[420px] w-full overflow-hidden rounded-lg bg-zinc-900">
        <Cropper image={`/api/photos/${photo.id}/display?uncropped=1&v=${photo.version}`} crop={crop} zoom={zoom} aspect={ASPECTS[aspectIdx]![1]}
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(areaPct) => setArea(areaPct)} />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="flex gap-1">
          {ASPECTS.map(([label], i) => (
            <button key={label} className={clsx('btn btn-sm', i === aspectIdx ? 'btn-primary' : 'btn-secondary')} onClick={() => setAspectIdx(i)}>{label}</button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-zinc-600">Zoom
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
      </div>
    </Modal>
  );
}
