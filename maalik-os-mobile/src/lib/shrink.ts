import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

/**
 * Photos are made small on the phone before they go anywhere (16 Oct 2026).
 *
 * A phone camera's photo is often 4-8 MB even at half quality, and the
 * website (on Vercel) stops any request over 4.5 MB. The phone saw that as
 * "no signal", so a job photo sat in Waiting to send for ever - and blocked
 * the voice note queued behind it. 1600 px on the long side keeps a serial
 * plate, a bill or a face readable at about 300-600 KB.
 */
export const PHOTO_MAX_SIDE = 1600;
/** Anything above this is refused on the phone with a clear reason, not sent to fail. */
export const UPLOAD_MAX_BYTES = 4_000_000;

/** A smaller JPEG copy of the photo, or null when it could not be made (the caller keeps the original). */
export async function shrinkPhoto(uri: string, opts: { base64?: boolean } = {}): Promise<{ uri: string; base64?: string } | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    let img = await ctx.renderAsync();
    if (Math.max(img.width, img.height) > PHOTO_MAX_SIDE) {
      ctx.resize(img.width >= img.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
      img = await ctx.renderAsync();
    }
    const out = await img.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: opts.base64 });
    return { uri: out.uri, base64: out.base64 };
  } catch {
    return null;
  }
}

/** Size of a local file in bytes, or null when it cannot be read. */
export function fileSize(uri: string): number | null {
  try {
    return new File(uri).size ?? null;
  } catch {
    return null;
  }
}
