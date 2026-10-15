'use client';

/**
 * The camera and the barcode decoder, with no UI.
 *
 * Two decoders behind one loop. Android Chrome ships a native BarcodeDetector
 * that is fast and handles damaged labels well; iPhone Safari and desktop
 * Firefox do not, so there the zxing library decodes the same frames. zxing
 * is loaded only when the native one is missing, so an Android phone never
 * downloads it.
 *
 * The loop draws the current video frame to a canvas a few times a second
 * and asks the decoder about that one frame. Owning the loop (instead of
 * handing the <video> to zxing) means one stop() really stops everything, the
 * camera light goes off, and both decoders behave identically.
 */

export const BARCODE_FORMATS = [
  'qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec',
] as const;

type Decode = (source: HTMLCanvasElement) => Promise<string[]>;

interface NativeDetector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

let decoderPromise: Promise<Decode> | null = null;

/** The best decoder this browser has, built once per page. */
export function getDecoder(): Promise<Decode> {
  if (decoderPromise) return decoderPromise;
  decoderPromise = (async (): Promise<Decode> => {
    const Native = (globalThis as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats();
        const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
        // A detector that cannot read Code 128 - what almost every serial
        // label uses - is not worth preferring over zxing.
        if (formats.includes('code_128')) {
          const det = new Native({ formats });
          return async (c) => (await det.detect(c)).map((r) => r.rawValue).filter(Boolean);
        }
      } catch { /* fall through to zxing */ }
    }
    const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    return async (c) => {
      try {
        return [reader.decodeFromCanvas(c).getText()];
      } catch {
        return []; // NotFoundException - nothing in this frame
      }
    };
  })();
  decoderPromise.catch(() => { decoderPromise = null; });
  return decoderPromise;
}

export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'busy' | 'none' | 'other';

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  insecure: 'The camera only works on a secure (https) address.',
  unsupported: 'This browser cannot use the camera. Use "Take a photo" instead.',
  denied: 'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.',
  busy: 'The camera is in use by another app. Close it and try again.',
  none: 'No camera was found on this device.',
  other: 'The camera could not be started. Use "Take a photo" instead.',
};

export function cameraProblemOf(err: unknown): CameraProblem {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  return 'other';
}

/** Open the back camera at a resolution good enough for small serial labels. */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'Insecure' });
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'Unsupported' });
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

export function problemFromOpen(err: unknown): CameraProblem {
  const name = (err as { name?: string })?.name;
  if (name === 'Insecure') return 'insecure';
  if (name === 'Unsupported') return 'unsupported';
  return cameraProblemOf(err);
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Torch (flash) where the phone exposes it - Android Chrome does, iPhone Safari does not. */
export function torchCapable(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  return !!caps.torch;
}

export async function setTorch(stream: MediaStream | null, on: boolean) {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

/**
 * Decode frames until stopped. Only the middle of the frame is read - where
 * the on-screen guide box is - so a second label at the edge of the shot is
 * not picked up by accident, and small labels get more pixels.
 */
export function startDecodeLoop(
  video: HTMLVideoElement,
  onCodes: (codes: string[]) => void,
  intervalMs = 180,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = async () => {
    if (stopped) return;
    try {
      const decode = await getDecoder();
      const w = video.videoWidth; const h = video.videoHeight;
      if (ctx && w && h) {
        const cw = Math.round(w * 0.8); const ch = Math.round(h * 0.6);
        canvas.width = cw; canvas.height = ch;
        ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
        const codes = await decode(canvas);
        if (!stopped && codes.length) onCodes(codes);
      }
    } catch { /* one bad frame is not an error */ }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Decode a still photo - the fallback when the live camera is not available. */
export async function decodeImageFile(file: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const decode = await getDecoder();
  return decode(canvas);
}

/** The current frame as a JPEG, for the AI reader. */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  return shrinkForUpload(canvas);
}

/**
 * Longest side 1600px, JPEG at 0.85. An invoice stays legible, the upload
 * stays around 300-600 KB on a shop's mobile data, and the AI bill is billed
 * on pixels - a 12-megapixel original costs several times more to read.
 */
export async function shrinkForUpload(source: Blob | HTMLCanvasElement): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (source instanceof HTMLCanvasElement) canvas = source;
  else {
    const bmp = await createImageBitmap(source);
    canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  }
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', 0.85),
  );
}

let audio: AudioContext | null = null;

/** A short beep and a buzz, so a person scanning a pile of boxes does not have to look at the screen. */
export function signalScan() {
  try {
    navigator.vibrate?.(60);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1760;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.08);
  } catch { /* sound is a nicety */ }
}
