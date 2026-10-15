'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useDialogFocus } from './useDialogFocus';
import { PopupCard, popupButton } from './ask';

/**
 * The standard dialog.
 *
 * Anatomy, matching the original: a soft-tinted rounded icon square, a bold
 * title with a quiet one-line explanation beneath it, and a close control in
 * the far corner. The body scrolls; the footer does not, so the primary action
 * is reachable without scrolling to the bottom of a long form.
 *
 * Rendered through a portal. A dialog nested inside a scrolling table gets
 * clipped by it - the same class of bug the row menu had.
 */
export function Modal({
  open = true,
  title,
  subtitle,
  icon = 'file-text',
  tone = 'brand',
  size = 'lg',
  footer,
  onClose,
  children,
}: {
  open?: boolean;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: 'brand' | 'navy' | 'accent' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Freeze the page behind the dialog, or the backdrop scrolls under it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!open || typeof document === 'undefined') return null;

  const WIDTH = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-5xl', xl: 'max-w-7xl' }[size];
  const TINT = {
    brand: 'bg-brand/10 text-on-tint-brand',
    navy: 'bg-navy/10 text-on-tint-navy',
    accent: 'bg-accent/15 text-accent',
    danger: 'bg-danger/10 text-on-tint-danger',
  }[tone];

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click; Escape and the close button do the same by keyboard
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-2 sm:p-4"
      onMouseDown={(e) => {
        // Only a click that both starts and ends on the backdrop closes it -
        // otherwise dragging to select text inside the dialog dismisses it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[94vh] w-full ${WIDTH} animate-slide-up flex-col overflow-hidden rounded-lg border border-border bg-card shadow-overlay`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${TINT}`}>
            <Icon name={icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight tracking-tight">{title}</h2>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ms-auto grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        <div className="thin-scroll flex-1 overflow-y-auto bg-background/70 p-4 sm:p-5">
          {children}
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-border bg-card px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation prompt.
 *
 * `window.confirm` was doing this job. It cannot be themed, it cannot explain
 * consequences, and on a white-label product it renders the tenant's domain
 * name in a system dialog - which is exactly the seam a client notices.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'brand',
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'brand' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // The same friendly card as `ask.confirm` (13 Oct 2026), so a confirmation
  // looks alike wherever it comes from. A risky one starts on Cancel.
  return (
    <PopupCard
      tone={tone}
      title={title}
      message={message}
      onDismiss={busy ? undefined : onClose}
      onSubmit={() => { if (!busy) onConfirm(); }}
      footer={
        <>
          <button type="button" autoFocus={tone === 'danger'} onClick={onClose} disabled={busy} className={popupButton.secondary}>
            Cancel
          </button>
          <button type="submit" autoFocus={tone !== 'danger'} disabled={busy} className={`${popupButton.primary(tone)} disabled:opacity-60`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    />
  );
}
