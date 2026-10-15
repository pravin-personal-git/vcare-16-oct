import { NextResponse } from 'next/server';
import { requireContext } from '@/server/context';
import { scopeForWrite } from '@/server/store-scope';
import { addAttachment, bytesMatchType, rejectReason, type DocType } from '@/server/attachments';
import { putFile, signedUrl, StorageNotConfigured } from '@/server/storage';
import { ATTACHABLE, canAttach } from '@/lib/attachment-access';

/**
 * File upload.
 *
 * A route rather than a server action because server actions cap the request
 * body at 1 MB by default and a scanned purchase order is routinely larger.
 * Raising that cap globally would apply to every action on the site, which is
 * a bigger surface than one upload needs.
 */

/** Which documents take files, and the edit right each needs: lib/attachment-access. */
const DOC_TYPES = ATTACHABLE as readonly DocType[];

export async function POST(req: Request) {
  try {
    const ctx = await requireContext();

    let storeId: string;
    try {
      storeId = scopeForWrite(ctx.scope);
    } catch {
      return NextResponse.json(
        { error: 'Select a single store before attaching a file - All Company is read-only.' },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const docType = String(form.get('docType') ?? '') as DocType;
    const docId = String(form.get('docId') ?? '');
    const label = form.get('label') ? String(form.get('label')) : null;
    const tag = form.get('tag') ? String(form.get('tag')) : null;
    const replaces = form.get('replaces') ? String(form.get('replaces')) : null;
    const file = form.get('file');

    if (!DOC_TYPES.includes(docType)) {
      return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 });
    }
    // Uploading a file to a document is editing that document.
    if (!canAttach(ctx.permissions, docType)) {
      return NextResponse.json({ error: 'You do not have permission to attach files.' }, { status: 403 });
    }
    if (!docId) {
      return NextResponse.json({ error: 'Missing document id.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
    }

    // Checked here, before a single byte reaches storage. Validating after the
    // upload means paying to store files we are about to reject.
    const reason = rejectReason(file.type, file.size);
    if (reason) return NextResponse.json({ error: reason }, { status: 400 });

    const bytes = await file.arrayBuffer();

    // The browser's `type` is derived from the extension, so renaming a file
    // is enough to make it lie. Read what the bytes actually say before
    // storing anything.
    const mismatch = bytesMatchType(file.type, new Uint8Array(bytes.slice(0, 32)));
    if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 });

    const stored = await putFile(storeId, docType, docId, {
      name: file.name,
      type: file.type,
      bytes,
    });

    const row = await addAttachment(
      ctx.scope,
      {
        docType,
        docId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath: stored.storagePath,
        label,
        tag,
        replaces,
      },
      ctx.user.id,
    );

    return NextResponse.json({
      id: row.id,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      // The client needs something to link to right away. One extra signing
      // call is cheaper than making the page reload to see the file it just
      // uploaded.
      url: await signedUrl(row.storagePath),
      label: row.label,
      uploadedAt: row.uploadedAt,
      uploadedByName: ctx.user.fullName,
      tag: row.tag,
      visibleToCustomer: row.visibleToCustomer,
      extracted: null,
      olderVersions: 0,
      replaced: replaces,
    });
  } catch (err) {
    if (err instanceof StorageNotConfigured) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    const msg = err instanceof Error ? err.message : 'Upload failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
