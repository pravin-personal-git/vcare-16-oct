import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { signedUrls, deleteFile } from './storage';
import { rejectReason } from '@/lib/file-type';

/**
 * Common Hub → Shared Files & Docs.
 *
 * Not attached to any quotation, order or invoice - that is
 * `DocumentAttachment`. This is a plain shared library: company policies, a
 * price list nobody wants to email around again, a signed contract with a
 * landlord. One flat label per file rather than a folder tree, matching the
 * reference app's own equivalent screen - a tree nobody has asked for is a
 * guess, and guesses in a schema are expensive to undo.
 *
 * Spec: 11-common-hub.md §2
 */

export interface SharedFileRow {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  folder: string;
  description: string | null;
  /** A short-lived signed link. Null when the object has gone missing. */
  url: string | null;
  uploadedAt: Date;
  uploadedByName: string | null;
}

export async function listSharedFiles(scope: StoreScope): Promise<SharedFileRow[]> {
  const rows = await db.sharedFile.findMany({
    where: scopeWhere(scope),
    orderBy: { uploadedAt: 'desc' },
  });

  const ids = [...new Set(rows.map((r) => r.uploadedBy).filter((x): x is string => !!x))];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  const links = await signedUrls(rows.map((r) => r.storagePath));

  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    folder: r.folder,
    description: r.description,
    url: links.get(r.storagePath) ?? null,
    uploadedAt: r.uploadedAt,
    uploadedByName: r.uploadedBy ? name.get(r.uploadedBy) ?? null : null,
  }));
}

export async function listSharedFileFolders(scope: StoreScope): Promise<string[]> {
  const rows = await db.sharedFile.groupBy({
    by: ['folder'],
    where: scopeWhere(scope),
    _count: { folder: true },
  });
  return rows.map((r) => r.folder).sort();
}

export async function addSharedFile(
  scope: StoreScope,
  input: {
    fileName: string; fileSize: number; mimeType: string; storagePath: string;
    folder?: string | null; description?: string | null;
  },
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  const reason = rejectReason(input.mimeType, input.fileSize);
  if (reason) throw new Error(reason);

  return db.sharedFile.create({
    data: {
      storeId,
      fileName: input.fileName.slice(0, 200),
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      storagePath: input.storagePath,
      folder: input.folder?.trim() || 'General',
      description: input.description?.trim() || null,
      uploadedBy: userId,
    },
  });
}

export async function removeSharedFile(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const found = await db.sharedFile.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { id: true, storagePath: true },
  });
  if (!found) throw new Error('That file is not in your scope.');

  /**
   * Row first, then the object - same ordering as removeAttachment, and the same
   * reason: wasted storage beats a row pointing at nothing.
   *
   * The row is tombstoned rather than removed (3 Oct 2026). The FILE is still
   * deleted, for the same reason as an attachment: a file somebody removed is
   * usually removed because it should not be kept.
   */
  await db.sharedFile.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
  await deleteFile(found.storagePath);
}
