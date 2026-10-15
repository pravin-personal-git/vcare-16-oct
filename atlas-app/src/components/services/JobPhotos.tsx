'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { JobPhoto } from '@/server/job-photos';

/**
 * The photos from a job, as the customer sees them (3 Oct 2026).
 *
 * WHY A GRID AND A LIGHTBOX RATHER THAN A FILE LIST.
 *
 * The staff side of this is `AttachmentPanel` - a list of file names with sizes
 * and an uploader, which is right for somebody managing documents. A customer is
 * not managing anything. They want to see what was wrong and what was done, so the
 * photo itself is the interface and the file name never appears.
 *
 * Tapping one opens it full-size, because on a phone a thumbnail of a meter
 * reading is useless.
 */
export function JobPhotos({ photos }: { photos: JobPhoto[] }) {
  const [open, setOpen] = useState<JobPhoto | null>(null);

  /**
   * Escape closes it.
   *
   * Not a nicety: a full-screen overlay with no keyboard way out traps anybody
   * not using a mouse, and the backdrop below is a real button for the same
   * reason. Registered only while a photo is open, so there is no listener on the
   * page the rest of the time.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const usable = photos.filter((p) => p.url);
  if (usable.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="camera" className="h-4 w-4 text-muted-foreground" />
        Photos from the visit
      </h2>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {usable.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              className="group block w-full overflow-hidden rounded-lg border border-border bg-muted/40 text-start"
            >
              {/*
                A plain <img>, not next/image. These are short-lived signed URLs
                from object storage - the optimiser would cache a URL that expires,
                and the customer would be shown a broken image instead of a photo.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url!}
                alt={p.label ?? 'Photo from the visit'}
                loading="lazy"
                className="aspect-square w-full object-cover transition group-hover:opacity-90"
              />
              {p.label && (
                <span className="block truncate px-2 py-1.5 text-xs text-muted-foreground">
                  {p.label}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {open?.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.label ?? 'Photo from the visit'}
          className="fixed inset-0 z-50 grid place-items-center bg-navy/80 p-4"
        >
          {/*
            The backdrop is a real button, not a div with a click handler. Tapping
            outside the photo to close is the expected gesture on a phone, and it
            has to be reachable by keyboard too - which a div never is.
          */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="absolute inset-0 cursor-default"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={open.url}
            alt={open.label ?? 'Photo from the visit'}
            className="pointer-events-none relative max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            autoFocus
            className="absolute end-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-card text-foreground shadow-overlay"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
}
