import { NextResponse } from 'next/server';
import { requireContext } from '@/server/context';
import { setOrgBrandAsset, clearOrgBrandAsset, getOrganization, BRAND_ASSET_FIELD, type BrandAssetKind } from '@/server/administration';
import { putBrandFile, deleteBrandFile, StorageNotConfigured } from '@/server/storage';
import { sniffMime } from '@/lib/file-type';

/**
 * Organisation brand assets - logo, seal, icon, favicon, invoice logo, payment
 * QR. A route rather than a server action for the same reason as
 * `/api/attachments` - the 1 MB server-action body cap.
 *
 * Deliberately its own small allowlist rather than reusing `ALLOWED_MIME` from
 * `lib/file-type.ts`: a brand image is never a PDF or a spreadsheet, and a
 * tighter size limit than a scanned document is the point.
 */

const BRAND_MIME: Record<string, string> = {
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/webp': 'WebP image',
};
const BRAND_MAX_BYTES = 2 * 1024 * 1024;

function rejectBrandFile(mimeType: string, size: number): string | null {
  if (!BRAND_MIME[mimeType]) {
    return `That file type is not accepted for a brand image. Allowed: ${Object.values(BRAND_MIME).join(', ')}.`;
  }
  if (size > BRAND_MAX_BYTES) {
    return `That image is too large. The limit is 2 MB.`;
  }
  if (size === 0) return 'That file is empty.';
  return null;
}

function isBrandKind(v: string): v is BrandAssetKind {
  return v in BRAND_ASSET_FIELD;
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return NextResponse.json({ error: 'You do not have permission to change brand assets.' }, { status: 403 });
    }

    const form = await req.formData();
    const kind = String(form.get('kind') ?? '');
    const file = form.get('file');

    if (!isBrandKind(kind)) {
      return NextResponse.json({ error: 'Unknown brand asset.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
    }

    const reason = rejectBrandFile(file.type, file.size);
    if (reason) return NextResponse.json({ error: reason }, { status: 400 });

    const bytes = await file.arrayBuffer();
    // The browser's `type` comes from the file extension, so a renamed file
    // lies about itself in good faith - read the actual bytes instead, same
    // check `/api/attachments` runs for documents.
    const actual = sniffMime(new Uint8Array(bytes.slice(0, 32)));
    if (actual !== file.type) {
      return NextResponse.json(
        { error: 'That file’s contents do not match the image type it claims to be.' },
        { status: 400 },
      );
    }

    const stored = await putBrandFile(ctx.organization.id, kind, {
      name: file.name,
      type: file.type,
      bytes,
    });
    await setOrgBrandAsset(ctx.organization.id, kind, stored.storagePath);

    return NextResponse.json({ kind, url: stored.url });
  } catch (err) {
    if (err instanceof StorageNotConfigured) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    const msg = err instanceof Error ? err.message : 'Upload failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return NextResponse.json({ error: 'You do not have permission to change brand assets.' }, { status: 403 });
    }

    const { kind } = (await req.json()) as { kind?: string };
    if (!kind || !isBrandKind(kind)) {
      return NextResponse.json({ error: 'Unknown brand asset.' }, { status: 400 });
    }

    // Read the path before clearing - once the column is null there is
    // nothing left to tell us which object to remove from storage.
    const field = BRAND_ASSET_FIELD[kind];
    const before = await getOrganization(ctx.organization.id);
    const previousPath = (before as unknown as Record<string, string | null>)[field];

    await clearOrgBrandAsset(ctx.organization.id, kind);

    // Best-effort: the pointer is already cleared, which is what makes the
    // logo disappear. Failing to also delete the object leaves an orphaned
    // file, not a broken one.
    if (previousPath) await deleteBrandFile(previousPath).catch(() => undefined);

    return NextResponse.json({ kind });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Remove failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
