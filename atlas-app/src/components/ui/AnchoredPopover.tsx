'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverAnchor { top: number; left: number; right: number; width: number }

/**
 * Anchors a popover to a trigger element, in viewport coordinates, for use
 * with `AnchoredPopover` below.
 *
 * Every header control that opens a small panel (store switcher, language,
 * presence, notifications, the user menu) used to position that panel with
 * plain `absolute` CSS inside the header bar. The header clips overflow -
 * legitimately, so its own content doesn't wrap badly on narrow screens -
 * which meant every one of those panels rendered, and even reported
 * `visibility: visible`, while being entirely invisible: cut off by an
 * ancestor they had no way to escape. `DataGrid`'s row menu solved this the
 * same way years earlier; this is that fix, shared.
 */
export function usePopoverAnchor<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const open = anchor !== null;

  const close = () => setAnchor(null);
  const toggle = () => {
    if (anchor) { close(); return; }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      top: rect.bottom + 6,
      left: rect.left,
      right: Math.max(0, window.innerWidth - rect.right),
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { ref, anchor, open, toggle, close };
}

/**
 * The panel itself - a portal into `document.body`, positioned from an
 * anchor computed by `usePopoverAnchor`. `align="end"` right-aligns to the
 * trigger (for controls that sit at the end of the header rail); the
 * default left-aligns.
 */
export function AnchoredPopover({
  anchor, align = 'start', width, onClose, className, children,
}: {
  anchor: PopoverAnchor;
  align?: 'start' | 'end';
  /** Fixed width in px. Defaults to the trigger's own width, at least 240px. */
  width?: number;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top: anchor.top,
          ...(align === 'end' ? { right: anchor.right } : { left: anchor.left }),
          width: width ?? Math.max(240, anchor.width),
        }}
        className={`z-[101] animate-fade-in overflow-hidden rounded-lg border border-border bg-card shadow-overlay ${className ?? ''}`}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
