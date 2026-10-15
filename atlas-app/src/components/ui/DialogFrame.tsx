'use client';

import { useRef, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';

/**
 * The backdrop of a dialog that draws its own box (health check UX-2) - the
 * big record forms and printable documents that do not fit the standard
 * Modal's anatomy. It gives them what Modal already has: announced as a
 * dialog, focus moved in and kept in, Escape closes, focus handed back.
 *
 * Escape is taken only from keys pressed inside this element's own DOM, so a
 * Modal opened from within it (portaled to <body>, but still a React child)
 * closes on its own without closing this one too.
 */
export function DialogFrame({
  label, onClose, className, closeOnBackdrop = false, children,
}: {
  label: string;
  onClose?: () => void;
  className: string;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape to close; the dialog itself is keyboard-complete
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={className}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !onClose) return;
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.stopPropagation();
        onClose();
      }}
      onMouseDown={closeOnBackdrop && onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      {children}
    </div>
  );
}
