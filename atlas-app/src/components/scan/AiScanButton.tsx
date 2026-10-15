'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { SCAN_KIND_LABEL, type ScanKind, type ScanResult } from '@/lib/scan/extraction';
import { ScannerOverlay } from './ScannerOverlay';
import { aiUnavailableReason, fetchAiStatus, readPhoto, type AiStatus } from './ai';

/**
 * "Scan invoice", "Scan visiting card", "Scan label" - a photo read by AI.
 *
 * Opens the camera in photo mode, sends the still to the reader, and hands
 * back the cleaned fields plus the photo itself, so the form can fill in and
 * later attach the photo to what it saved. When AI reading is off, not set
 * up, or out of reads for the month, the button still shows - so people know
 * it exists - but explains why instead of opening the camera.
 */
export function AiScanButton<K extends ScanKind>({
  kind,
  label,
  onResult,
  className = '',
}: {
  kind: K;
  label?: string;
  onResult: (result: Extract<ScanResult, { kind: K }>, photo: Blob) => void;
  className?: string;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { fetchAiStatus().then(setStatus); }, []);

  const start = async () => {
    setMessage(null);
    const s = await fetchAiStatus(true);
    setStatus(s);
    const why = aiUnavailableReason(s);
    if (why) { setMessage(why); return; }
    setOpen(true);
  };

  const read = async (photo: Blob) => {
    setReading(true);
    setMessage(null);
    try {
      const result = await readPhoto(kind, photo);
      onResult(result as Extract<ScanResult, { kind: K }>, photo);
      fetchAiStatus(true).then(setStatus);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that photo.');
    } finally {
      setReading(false);
    }
  };

  const unavailable = status ? aiUnavailableReason(status) : null;
  const text = label ?? `Scan ${SCAN_KIND_LABEL[kind].toLowerCase()}`;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={start}
        disabled={reading}
        title={unavailable ?? `Take a photo and fill this in automatically${status ? ` · ${status.remaining} reads left this month` : ''}`}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition disabled:opacity-60 ${
          unavailable ? 'border-border bg-muted/40 text-muted-foreground' : 'border-brand/40 bg-brand/[0.06] text-on-tint-brand hover:bg-brand/10'
        } ${className}`}
      >
        <Icon name={reading ? 'refresh' : 'camera'} className={`h-4 w-4 ${reading ? 'animate-spin' : ''}`} />
        {reading ? 'Reading…' : text}
        {!unavailable && <Icon name="sparkles" className="h-3 w-3 opacity-70" />}
      </button>
      {message && <span role="status" className="max-w-xs text-xs leading-snug text-danger">{message}</span>}
      {open && (
        <ScannerOverlay
          mode="photo"
          title={text}
          hint={kind === 'supplier_invoice'
            ? 'Whole invoice in the frame, flat, in good light. Photo is read by AI.'
            : kind === 'visiting_card' ? 'Fill the frame with the card. Photo is read by AI.'
              : 'Get the model and serial printed on the box in the frame. Photo is read by AI.'}
          onPhoto={read}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
