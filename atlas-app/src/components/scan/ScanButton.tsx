'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ScannerOverlay } from './ScannerOverlay';

/**
 * The camera button that sits beside a serial or barcode field.
 *
 * Single: one read fills the field and the camera closes. Continuous: the
 * camera stays open collecting codes until Done - for the one-per-line serial
 * boxes on a goods receipt. The field keeps working exactly as before for a
 * USB scanner or typing; this only adds the phone camera as a third way in.
 */
export function ScanButton({
  onScan,
  onScanMany,
  existing = [],
  title,
  hint,
  label,
  className = '',
  disabled = false,
}: {
  /** Single mode: called with the one code read. */
  onScan?: (code: string) => void;
  /** Continuous mode: called once, with every new code, when the person presses Done. */
  onScanMany?: (codes: string[]) => void;
  /** Codes already entered - scanning one again is skipped rather than duplicated. */
  existing?: string[];
  title?: string;
  hint?: string;
  /** Visible text beside the icon. Icon-only when absent. */
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const continuous = !!onScanMany;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={label ?? (continuous ? 'Scan with camera' : 'Scan with camera')}
        title={continuous ? 'Scan many with the camera' : 'Scan with the camera'}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card text-muted-foreground transition hover:border-brand hover:text-brand disabled:opacity-40 ${label ? 'h-8 px-2.5 text-xs font-medium' : 'h-8 w-8'} ${className}`}
      >
        <Icon name="camera" className="h-4 w-4" />
        {label}
      </button>
      {open && (
        <ScannerOverlay
          mode="code"
          continuous={continuous}
          title={title}
          hint={hint}
          initialCodes={existing}
          onCodes={(codes) => (continuous ? onScanMany?.(codes) : onScan?.(codes[0]))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
