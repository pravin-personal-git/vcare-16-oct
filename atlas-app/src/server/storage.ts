import 'server-only';

/**
 * File storage, on a PRIVATE Supabase Storage bucket.
 *
 * The database holds an object key; the bytes live in object storage. Putting a
 * 6 MB scanned purchase order in a Postgres column makes every backup, every
 * restore and every `pg_dump` slower forever, and Supabase bills the database
 * tier by size.
 *
 * WHY PRIVATE, NOT PUBLIC
 *
 * A public bucket hands out permanent, unauthenticated URLs. The keys here
 * contain a UUID so they are not guessable - but "not guessable" is not the
 * same as "not readable". A link that leaks once, into a browser history, a
 * chat, a support ticket or a screenshot, works forever and for anyone.
 *
 * What goes in this bucket is customer purchase orders, signed quotations and
 * photographs of cheques. That is somebody else's commercial and financial
 * data, held on their behalf. And because this is a white-label product, it is
 * a *client's* customers' data - which makes it their liability and their
 * reputation, not just ours.
 *
 * So: private bucket, and a signed URL minted per request for someone who
 * already holds a session. The link expires; access follows the login.
 *
 * Uploaded over the REST API rather than @supabase/supabase-js. The SDK is a
 * dependency to keep current and all we need from it is three authenticated
 * HTTP calls.
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'attachments';

/**
 * How long a download link lives.
 *
 * Long enough to click, open in a new tab, and come back to. Short enough that
 * a link pasted somewhere it should not be is dead by the time anyone finds it.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export class StorageNotConfigured extends Error {
  constructor(bucket: string = BUCKET, visibility: 'PRIVATE' | 'PUBLIC' = 'PRIVATE') {
    super(
      `File storage is not set up yet. Create a ${visibility} bucket named "`
      + bucket
      + '" in Supabase Storage, then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
    this.name = 'StorageNotConfigured';
  }
}

/**
 * `bucket`/`visibility` only change the error message if credentials are
 * missing - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are shared across both
 * buckets, so there is only ever one thing to actually go and fix. Naming the
 * right bucket in the message is what stops someone reading "attachments"
 * while they are trying to upload a logo.
 */
function config(bucket: string = BUCKET, visibility: 'PRIVATE' | 'PUBLIC' = 'PRIVATE') {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageNotConfigured(bucket, visibility);
  return { url: url.replace(/\/$/, ''), key };
}

export function isStorageConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/**
 * A safe object key.
 *
 * The original filename goes in the database for display; it never goes in the
 * path. A customer-supplied name can contain slashes, `..`, control characters
 * and a hundred other things that turn a path join into a security question -
 * and none of that is worth defending against when a random key works just as
 * well.
 *
 * The store id leads the key so a future move to per-tenant buckets or storage
 * policies has something to key off.
 */
function objectKey(storeId: string, docType: string, docId: string, fileName: string): string {
  const ext = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
  return `${storeId}/${docType}/${docId}/${crypto.randomUUID()}.${ext}`;
}

export async function putFile(
  storeId: string,
  docType: string,
  docId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<{ storagePath: string }> {
  const { url, key } = config();
  const path = objectKey(storeId, docType, docId, file.name);

  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'false',
      'cache-control': '3600',
    },
    body: file.bytes,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && body.includes('Bucket not found')) {
      throw new Error(
        `The storage bucket "${BUCKET}" does not exist. Create it in Supabase → Storage as a PRIVATE bucket.`,
      );
    }
    if (res.status === 413 || body.includes('exceeded the maximum allowed size')) {
      throw new Error('That file is larger than the bucket allows.');
    }
    if (body.includes('mime type') || body.includes('not allowed')) {
      throw new Error('That file type is not allowed by the storage bucket.');
    }
    throw new Error(`Upload failed (${res.status}). ${body.slice(0, 200)}`);
  }

  return { storagePath: path };
}

/**
 * Short-lived download links, minted in one call for a whole list.
 *
 * Signing each path separately would be one network round trip per file, which
 * on a ten-file invoice is ten trips before the page can render.
 */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const { url, key } = config();

  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS, paths }),
  });

  if (!res.ok) return out;

  const rows = (await res.json()) as { signedURL?: string; path?: string; error?: string }[];
  for (const r of rows) {
    // A file deleted from the bucket but still in the database signs as an
    // error. Skipping it leaves the row visible with no link, which is more
    // honest than a link that 404s.
    if (r.signedURL && r.path) out.set(r.path, `${url}/storage/v1${r.signedURL}`);
  }
  return out;
}

export async function signedUrl(path: string): Promise<string | null> {
  return (await signedUrls([path])).get(path) ?? null;
}

export async function deleteFile(storagePath: string): Promise<void> {
  const { url, key } = config();
  await fetch(`${url}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => undefined);
}

/**
 * Brand assets - logos, seals, favicons, the payment QR - on a SEPARATE
 * PUBLIC bucket.
 *
 * These are not the same trust class as a customer's purchase order. A logo
 * has to render in a browser tab, an emailed PDF and a printed invoice with no
 * session behind any of those - a 10-minute signed URL cannot do that. So they
 * live in their own bucket, and that bucket really is public: nothing in it is
 * a secret, only the organisation's own public-facing identity.
 *
 * One object per (org, kind) - re-uploading a logo replaces it in place
 * (`x-upsert: true`), rather than the attachments pattern of a new UUID every
 * time. A logo is a singleton, not a growing list, and a stable key means the
 * URL already saved on a hundred printed documents keeps working.
 */

const BRAND_BUCKET = process.env.SUPABASE_BRAND_BUCKET ?? 'brand';

export type BrandAssetKind = 'logo' | 'seal' | 'icon' | 'favicon' | 'invoiceLogo' | 'paymentQr';

function brandObjectKey(orgId: string, kind: BrandAssetKind, fileName: string): string {
  const ext = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'png').toLowerCase();
  return `${orgId}/${kind}.${ext}`;
}

export async function putBrandFile(
  orgId: string,
  kind: BrandAssetKind,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<{ storagePath: string; url: string }> {
  const { url, key } = config(BRAND_BUCKET, 'PUBLIC');
  const path = brandObjectKey(orgId, kind, file.name);

  const res = await fetch(`${url}/storage/v1/object/${BRAND_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body: file.bytes,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && body.includes('Bucket not found')) {
      throw new Error(
        `The storage bucket "${BRAND_BUCKET}" does not exist. Create it in Supabase → Storage as a PUBLIC bucket.`,
      );
    }
    if (res.status === 413 || body.includes('exceeded the maximum allowed size')) {
      throw new Error('That file is larger than the bucket allows.');
    }
    throw new Error(`Upload failed (${res.status}). ${body.slice(0, 200)}`);
  }

  // config() already succeeded above, so this can only be a real URL -
  // publicBrandUrl's null case exists for a caller with no config, not this one.
  return { storagePath: path, url: `${url}/storage/v1/object/public/${BRAND_BUCKET}/${path}` };
}

/**
 * Never throws. A document renders with or without a logo; storage being
 * unconfigured must never be the reason an invoice fails to open.
 */
export function publicBrandUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  try {
    const { url } = config(BRAND_BUCKET, 'PUBLIC');
    return `${url}/storage/v1/object/public/${BRAND_BUCKET}/${storagePath}`;
  } catch {
    return null;
  }
}

export async function deleteBrandFile(storagePath: string): Promise<void> {
  const { url, key } = config(BRAND_BUCKET, 'PUBLIC');
  await fetch(`${url}/storage/v1/object/${BRAND_BUCKET}/${storagePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => undefined);
}

/**
 * Product photos for the shop (3 Oct 2026), in the same PUBLIC brand bucket.
 *
 * Same trust class as a logo: a picture of a camera a business chose to show
 * the public, with nothing secret in it. It has to render for a visitor with no
 * session, which a signed URL cannot do.
 *
 * Unlike a logo, a product has several photos and each is its own object, so
 * the key carries a random id and never overwrites - removing one from the
 * shop does not destroy a file somebody may want back.
 */
export const CATALOGUE_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
export const CATALOGUE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export async function putCatalogueImage(
  orgId: string,
  listingId: string,
  file: { type: string; bytes: ArrayBuffer },
): Promise<{ storagePath: string }> {
  const ext = CATALOGUE_IMAGE_TYPES[file.type];
  if (!ext) throw new Error('Use a JPG, PNG or WebP photo.');
  if (file.bytes.byteLength > CATALOGUE_IMAGE_MAX_BYTES) throw new Error('That photo is over 5 MB. Please use a smaller one.');

  const { url, key } = config(BRAND_BUCKET, 'PUBLIC');
  const path = `${orgId}/catalogue/${listingId}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${url}/storage/v1/object/${BRAND_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': file.type,
      'x-upsert': 'false',
      'cache-control': '86400',
    },
    body: file.bytes,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && body.includes('Bucket not found')) {
      throw new Error(`The storage bucket "${BRAND_BUCKET}" does not exist. Create it in Supabase → Storage as a PUBLIC bucket.`);
    }
    throw new Error(`Upload failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return { storagePath: path };
}
