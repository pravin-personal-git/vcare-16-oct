import { NextResponse } from 'next/server';
import { requireContext } from '@/server/context';
import { scopeForWrite } from '@/server/store-scope';
import { addSharedFile, removeSharedFile } from '@/server/shared-files';
import { putFile, StorageNotConfigured } from '@/server/storage';
import { bytesMatchType, rejectReason } from '@/lib/file-type';

/**
 * Common Hub → Shared Files & Docs. Same shape as `/api/attachments` - a route
 * rather than a server action for the request-body-size reason documented
 * there - pointed at `SharedFile` instead of a specific quotation/order/invoice.
 */

export async function POST(req: Request) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return NextResponse.json({ error: 'You do not have permission to add shared files.' }, { status: 403 });
    }

    let storeId: string;
    try {
      storeId = scopeForWrite(ctx.scope);
    } catch {
      return NextResponse.json(
        { error: 'Select a single store before uploading a file - All Company is read-only.' },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const folder = form.get('folder') ? String(form.get('folder')) : null;
    const description = form.get('description') ? String(form.get('description')) : null;
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
    }

    const reason = rejectReason(file.type, file.size);
    if (reason) return NextResponse.json({ error: reason }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const mismatch = bytesMatchType(file.type, new Uint8Array(bytes.slice(0, 32)));
    if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 });

    // `docId` here is only a storage-path grouping key, not a foreign key to
    // anything - a shared file is not attached to a document, it IS the
    // document. A fresh id keeps every upload's object key unique.
    const stored = await putFile(storeId, 'shared', crypto.randomUUID(), {
      name: file.name,
      type: file.type,
      bytes,
    });

    const row = await addSharedFile(
      ctx.scope,
      {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath: stored.storagePath,
        folder,
        description,
      },
      ctx.user.id,
    );

    return NextResponse.json({ id: row.id, fileName: row.fileName });
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
      return NextResponse.json({ error: 'You do not have permission to remove shared files.' }, { status: 403 });
    }

    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: 'Missing file id.' }, { status: 400 });

    await removeSharedFile(ctx.scope, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Remove failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
