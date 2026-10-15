'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { listImagesAction, removeImageAction, setCoverAction, uploadImagesAction } from './actions';

/**
 * A product's photos for the shop (3 Oct 2026, Pravin's approved mock-up).
 *
 * Photos are SHRUNK IN THE BROWSER before they are sent. A phone photo is 3-8
 * MB; Vercel refuses any request over 4.5 MB whatever the app allows, and a
 * shop card is 400 pixels wide. 1600 pixels on the long side is sharp on a
 * product page and usually a few hundred KB. One photo per request, so a
 * failure loses one photo, not the batch.
 */

const MAX_EDGE = 1600;
const MAX_PHOTOS = 6;

interface Photo { id: string; url: string | null; alt: string | null }

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return file;
  // White behind a transparent PNG, or it turns black as a JPEG.
  // A literal on purpose: this paints pixels into a JPEG file, not the page, so
  // a theme token would not apply.
  // eslint-disable-next-line no-restricted-syntax
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85));
}

export function PhotoManager({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await listImagesAction(productId);
    setPhotos(r.images);
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - (photos?.length ?? 0);
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (list.length === 0) {
      setError(room <= 0 ? `${MAX_PHOTOS} photos is the limit on one product.` : 'Choose a photo (JPG, PNG or WebP).');
      return;
    }
    for (let i = 0; i < list.length; i += 1) {
      setBusy(`Adding photo ${i + 1} of ${list.length}…`);
      try {
        const blob = await shrink(list[i]);
        const fd = new FormData();
        fd.set('productId', productId);
        fd.append('photos', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
        const r = await uploadImagesAction(fd);
        if (r.error) { setError(r.error); break; }
      } catch {
        setError('That photo could not be read. Try a JPG or PNG.');
        break;
      }
    }
    setBusy(null);
    if (input.current) input.current.value = '';
    await load();
  };

  const act = async (label: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(label);
    setError(null);
    const r = await fn();
    if (r.error) setError(r.error);
    setBusy(null);
    await load();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Photos</p>
        <p className="text-xs text-muted-foreground">
          {photos ? `${photos.length} of ${MAX_PHOTOS}` : 'Loading…'} · the first is the cover
        </p>
      </div>

      {/* Drag-and-drop is an extra for a mouse; the file input inside the
          label is the real, keyboard-reachable control. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <label
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border px-3 py-4 text-center transition hover:border-brand ${disabled || busy ? 'pointer-events-none opacity-60' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}
      >
        <Icon name="upload" className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm font-semibold">{busy ?? 'Drop photos here, or tap to choose'}</span>
        <span className="text-xs text-muted-foreground">JPG, PNG or WebP · a phone camera works too</span>
        <input
          ref={input}
          id={`photos-${productId}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          disabled={disabled || !!busy}
          onChange={(e) => void upload(e.target.files)}
        />
      </label>

      {error && <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-on-tint-danger">{error}</p>}

      {photos && photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <figure key={p.id} className={`relative overflow-hidden rounded-lg border-2 ${i === 0 ? 'border-accent' : 'border-border'}`}>
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image
                <img src={p.url} alt={p.alt ?? ''} className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center bg-muted text-xs text-muted-foreground">
                  Storage not set up
                </div>
              )}
              {i === 0 && (
                <span className="absolute start-1 top-1 rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">Cover</span>
              )}
              <figcaption className="flex justify-between gap-1 bg-card p-1">
                {i > 0 ? (
                  <Button variant="ghost" size="sm" disabled={disabled || !!busy} onClick={() => act('Changing the cover…', () => setCoverAction(p.id))}>
                    Cover
                  </Button>
                ) : <span />}
                <Button variant="ghost" size="sm" icon="trash" aria-label="Remove photo" disabled={disabled || !!busy} onClick={() => act('Removing…', () => removeImageAction(p.id))} />
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
