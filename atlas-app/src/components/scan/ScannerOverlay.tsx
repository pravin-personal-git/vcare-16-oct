'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { acceptScan, cleanScannedCode, emptyCollector, type CollectorState } from '@/lib/scan/codes';
import {
  CAMERA_PROBLEM_TEXT, decodeImageFile, grabFrame, openCamera, problemFromOpen, setTorch,
  shrinkForUpload, signalScan, startDecodeLoop, stopStream, torchCapable, type CameraProblem,
} from './engine';

/**
 * The full-screen camera.
 *
 * Two jobs:
 *   CODE  - read barcodes and QR codes live. Single: the first read closes
 *           the camera and fills the field. Continuous: every new code beeps
 *           and joins a list at the bottom until Done - twenty cameras off a
 *           delivery without touching the screen between them.
 *   PHOTO - take one still for the AI reader (an invoice, a card, a label).
 *
 * When the live camera cannot start - permission refused, an old in-app
 * browser, a desktop with no webcam - the same screen falls back to the
 * phone's own camera app through a file input, which works everywhere.
 *
 * Rendered above everything (z-index over the standard Modal) because it is
 * usually opened from inside one, and Escape is caught before the modal
 * underneath sees it, so closing the camera does not also throw away a
 * half-filled goods receipt.
 */
export function ScannerOverlay({
  mode,
  continuous = false,
  title,
  hint,
  initialCodes = [],
  onCodes,
  onPhoto,
  onClose,
}: {
  mode: 'code' | 'photo';
  continuous?: boolean;
  title?: string;
  hint?: string;
  /** Codes already in the field - a repeat of one of these is ignored, not re-added. */
  initialCodes?: string[];
  onCodes?: (codes: string[]) => void;
  onPhoto?: (photo: Blob) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const collectorRef = useRef<CollectorState>({ ...emptyCollector(), codes: initialCodes.map(cleanScannedCode).filter(Boolean) });
  const doneRef = useRef(false);

  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [ready, setReady] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const finish = useCallback((codes: string[]) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopLoopRef.current?.();
    stopStream(streamRef.current);
    if (codes.length) onCodes?.(codes);
    onClose();
  }, [onClose, onCodes]);

  const close = useCallback(() => {
    // Closing a continuous scan keeps what was scanned - losing twenty
    // serials to a mis-tap on the X would be the worst possible behaviour.
    if (continuous && added.length) finish(added);
    else { doneRef.current = true; stopLoopRef.current?.(); stopStream(streamRef.current); onClose(); }
  }, [continuous, added, finish, onClose]);

  const handleCodes = useCallback((codes: string[]) => {
    for (const raw of codes) {
      const r = acceptScan(collectorRef.current, raw, Date.now());
      if (r.result !== 'added') continue;
      collectorRef.current = r.state;
      const code = r.state.codes[r.state.codes.length - 1];
      signalScan();
      if (!continuous) { finish([code]); return; }
      setAdded((prev) => [...prev, code]);
      setFlash(code);
    }
  }, [continuous, finish]);

  // Start the camera once; stop it on the way out whatever the path.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await openCamera();
        if (cancelled) { stopStream(stream); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        setReady(true);
        setTorchOk(torchCapable(stream));
        if (mode === 'code') stopLoopRef.current = startDecodeLoop(v, handleCodes);
      } catch (err) {
        if (!cancelled) setProblem(problemFromOpen(err));
      }
    })();
    return () => {
      cancelled = true;
      stopLoopRef.current?.();
      stopStream(streamRef.current);
    };
    // handleCodes is stable enough for the life of one overlay; restarting the
    // camera because a callback identity changed would flicker the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Escape closes the camera only - not the form underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  const snap = async () => {
    const v = videoRef.current;
    if (!v || !ready) return;
    setBusy(true);
    try {
      const photo = await grabFrame(v);
      doneRef.current = true;
      stopStream(streamRef.current);
      onPhoto?.(photo);
      onClose();
    } catch {
      setNote('Could not take the photo. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** The fallback path: a still from the phone's camera app or the gallery. */
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNote(null);
    setBusy(true);
    try {
      if (mode === 'photo') {
        const photo = await shrinkForUpload(file);
        doneRef.current = true;
        stopStream(streamRef.current);
        onPhoto?.(photo);
        onClose();
        return;
      }
      const codes = await decodeImageFile(file);
      if (codes.length === 0) setNote('No barcode was found in that photo. Hold the label flat, fill the frame, and try again.');
      else handleCodes(codes);
    } catch {
      setNote('That photo could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const toggleTorch = async () => {
    try { await setTorch(streamRef.current, !torchOn); setTorchOn(!torchOn); } catch { setTorchOk(false); }
  };

  if (typeof document === 'undefined') return null;

  const heading = title ?? (mode === 'photo' ? 'Take a photo' : continuous ? 'Scan codes' : 'Scan a code');
  const guide = hint ?? (mode === 'photo'
    ? 'Fit the whole page in the frame, flat and in good light.'
    : 'Point at the barcode or QR code. It reads by itself.');

  return createPortal(
    <div className="fixed inset-0 z-[400] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={heading}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
        <Icon name={mode === 'photo' ? 'camera' : 'scan'} className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="truncate text-xs text-white/70">{guide}</p>
        </div>
        {torchOk && (
          <button type="button" onClick={toggleTorch} aria-label={torchOn ? 'Torch off' : 'Torch on'}
            className={`grid h-10 w-10 place-items-center rounded-full ${torchOn ? 'bg-warning text-black' : 'bg-white/15'}`}>
            <Icon name="zap" className="h-5 w-5" />
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close camera"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/15">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {!problem && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className={`rounded-xl border-2 ${flash ? 'border-success' : 'border-white/80'} ${mode === 'photo' ? 'h-[80%] w-[88%]' : 'h-[45%] w-[80%]'} shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-colors`} />
          </div>
        )}
        {!ready && !problem && (
          <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/80">Starting the camera…</p>
        )}
        {problem && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <p className="max-w-sm text-center text-sm leading-relaxed">{CAMERA_PROBLEM_TEXT[problem]}</p>
          </div>
        )}
        {flash && (
          <p className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] truncate rounded-full bg-success px-3 py-1 font-mono text-xs text-white">
            ✓ {flash}
          </p>
        )}
      </div>

      <div className="space-y-2 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-2">
        {note && <p className="rounded-md bg-danger/80 px-3 py-2 text-xs">{note}</p>}

        {continuous && mode === 'code' && (
          <div className="max-h-28 overflow-y-auto rounded-md bg-white/10 p-2">
            {added.length === 0 ? (
              <p className="text-xs text-white/70">Scanned codes appear here. Repeats are skipped.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {added.map((c) => (
                  <li key={c} className="flex items-center gap-1 rounded bg-white/15 py-0.5 pe-1 ps-2 font-mono text-xs">
                    {c}
                    <button type="button" aria-label={`Remove ${c}`} className="grid h-5 w-5 place-items-center rounded hover:bg-white/20"
                      onClick={() => {
                        setAdded((prev) => prev.filter((x) => x !== c));
                        collectorRef.current = {
                          ...collectorRef.current,
                          codes: collectorRef.current.codes.filter((x) => x !== c),
                        };
                      }}>
                      <Icon name="x" className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white/15 px-4 text-xs font-medium">
            <Icon name="image" className="h-4 w-4" />
            {problem ? 'Take a photo' : 'From a photo'}
            <input type="file" accept="image/*" capture={problem ? 'environment' : undefined} className="sr-only"
              disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <div className="flex-1" />
          {mode === 'photo' && !problem && (
            <button type="button" onClick={snap} disabled={!ready || busy} aria-label="Take photo"
              className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40">
              <span className="h-11 w-11 rounded-full bg-white" />
            </button>
          )}
          {continuous && mode === 'code' && (
            <button type="button" onClick={() => finish(added)}
              className="h-11 rounded-full bg-brand px-5 text-sm font-semibold text-brand-fg">
              Done ({added.length})
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
