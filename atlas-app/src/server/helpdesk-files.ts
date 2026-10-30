import 'server-only';
import { addAttachment, bytesMatchType, rejectReason } from './attachments';
import { putFile, signedUrl } from './storage';
import type { CommentFile } from './helpdesk';

/**
 * A screenshot or file on one helpdesk comment (30 Oct 2026) - from the
 * business's side (/api/helpdesk/files) or the support team's
 * (/api/platform/support/files). The caller has already checked who may add
 * to that comment; this checks the file itself and stores it.
 */
export async function putHelpdeskFile(storeId: string, commentId: string, file: File, userId: string): Promise<CommentFile> {
  const reason = rejectReason(file.type, file.size);
  if (reason) throw new Error(reason);
  const bytes = await file.arrayBuffer();
  const mismatch = bytesMatchType(file.type, new Uint8Array(bytes.slice(0, 32)));
  if (mismatch) throw new Error(mismatch);
  const stored = await putFile(storeId, 'helpdesk_comment', commentId, { name: file.name, type: file.type, bytes });
  const row = await addAttachment(
    { kind: 'single', storeId, writable: true },
    { docType: 'helpdesk_comment', docId: commentId, fileName: file.name, fileSize: file.size, mimeType: file.type, storagePath: stored.storagePath },
    userId,
  );
  return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, url: await signedUrl(row.storagePath) };
}
