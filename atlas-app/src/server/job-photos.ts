import 'server-only';
import { db } from './db';
import { signedUrls } from './storage';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * JOB PHOTOS, AS THE CUSTOMER SEES THEM (3 Oct 2026).
 *
 * The portal has had a "Show job photos" switch since F1a and there was nothing
 * behind it - no model, no upload, no screen. It sat on the `PENDING_WIRING`
 * burn-down for exactly that reason.
 *
 * A photo of a job is a document attached to that job, so it is a
 * `DocumentAttachment` with `docType: 'complaint'` rather than a table of its own.
 * That buys the storage, the signed links, the size and type limits, the audit
 * trigger and the tombstone behaviour that already work for every other
 * attachment, and it means the office and the portal are looking at one list.
 *
 * ## Why this is its own function and not `listAttachments`
 *
 * `listAttachments` takes a `StoreScope`, which a portal visitor does not have -
 * they are a customer, not a user of the business. Reusing it would mean
 * manufacturing a scope for somebody who has no staff role, which is exactly the
 * sort of shortcut that later becomes a cross-tenant leak.
 *
 * So the scope here is explicit and narrow: this store, this complaint, and
 * **images only**. The caller has already proved the job belongs to this customer
 * (`getMyComplaintDetail`); this function proves nothing and is never called
 * without that check in front of it.
 */

export interface JobPhoto {
  id: string;
  /** A short-lived signed link. Null when the object has gone from storage. */
  url: string | null;
  /** What the office typed, if anything - "before", "meter reading". */
  label: string | null;
  takenAt: string;
}

/**
 * Images only, deliberately.
 *
 * An attachment on a job can be a supplier's PDF quote or an internal note the
 * office scanned in. Those are not "job photos" and showing a customer every file
 * anybody ever hung off their complaint would be a privacy accident waiting to
 * happen. If a client wants to share a document with a customer, that is
 * `portal.documents` and the invoice list, not this.
 */
const IMAGE = 'image/';

export async function listJobPhotosForCustomer(
  storeId: string, complaintId: string,
): Promise<JobPhoto[]> {
  const rows = await db.documentAttachment.findMany({
    // 11 Oct 2026: only files marked "Customer sees it", and not a replaced
    // older version. Job photos taken before then were marked visible by the
    // migration, so what the customer saw yesterday they still see.
    where: { storeId, docType: 'complaint', docId: complaintId, visibleToCustomer: true, replacedById: null },
    orderBy: { uploadedAt: 'asc' },
    take: LIST_MAX_ROWS,
    select: { id: true, mimeType: true, storagePath: true, label: true, uploadedAt: true },
  });

  const images = rows.filter((r) => r.mimeType.startsWith(IMAGE));
  if (images.length === 0) return [];

  // One signing call for the whole list, not one per file.
  const links = await signedUrls(images.map((r) => r.storagePath)).catch(() => new Map<string, string>());

  return images.map((r) => ({
    id: r.id,
    url: links.get(r.storagePath) ?? null,
    label: r.label,
    takenAt: r.uploadedAt.toISOString(),
    // No uploader name. The customer does not need to know which member of staff
    // held the camera, and on a small team it would identify them by elimination.
  }));
}
