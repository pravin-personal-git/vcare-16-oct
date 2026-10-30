import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { signedUrls } from './storage';
import { rejectReason } from '@/lib/file-type';
import { cleanRequired, cleanTag, DEFAULT_REQUIRED, DEFAULT_TAG, type RequiredRule } from '@/lib/attachment-tags';

/**
 * Files hung off a sales document.
 *
 * The reference lets you attach documents to a quotation - a signed copy, the
 * customer's purchase order, a site photo. Those attachments are usually the
 * only record of *why* a price was agreed, so losing them costs more than
 * losing the quotation itself.
 *
 * 11 Oct 2026 (ops-pages demo tab 4): files now carry a tag, can be shown to
 * the customer, replaced by a newer version (old kept), read by the AI
 * reader, and checked against what the document needs (Settings › Required
 * documents).
 *
 * Spec: 04-quotation.md §7
 */

/** The sales documents - these can also be closed and reopened (server/archive). */
export type SalesDocType = 'quotation' | 'sales_order' | 'invoice';
/**
 * Everything a file can hang off. Goods receipts and leads carry the photo
 * the camera scanner read them from - the supplier's invoice, the visiting
 * card - so the record shows where its data came from.
 *
 * `complaint` added 3 Oct 2026 for JOB PHOTOS. The portal has had a "Show job
 * photos" switch since F1a and there was nothing for it to show - no model, no
 * upload, no screen. A photo of a job is a document attached to that job, so it
 * belongs here rather than in a `JobPhoto` table of its own: it then inherits the
 * storage, the signed links, the size and type limits, the audit trigger and the
 * tombstone behaviour that already work for every other attachment.
 *
 * `receipt` added 11 Oct 2026: the payment proof (UPI screenshot, cheque photo).
 */
export type DocType = SalesDocType | 'goods_receipt' | 'lead' | 'complaint' | 'installation_challan' | 'receipt' | 'helpdesk_comment';

export {
  ALLOWED_MIME, MAX_BYTES, describeSize, rejectReason, sniffMime, bytesMatchType,
} from '@/lib/file-type';

export interface AttachmentRow {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** A short-lived signed link. Null when the object has gone missing. */
  url: string | null;
  label: string | null;
  uploadedAt: Date;
  uploadedByName: string | null;
  /** 11 Oct 2026 (lib/attachment-tags). */
  tag: string | null;
  visibleToCustomer: boolean;
  /** What the AI reader found, e.g. { summary: 'PO 4471 · ₹ 34,810', match: true }. */
  extracted: { summary?: string; match?: boolean | null } | null;
  /** Earlier versions this file replaced - kept, not shown. */
  olderVersions: number;
}

export async function listAttachments(
  scope: StoreScope,
  docType: DocType,
  docId: string,
): Promise<AttachmentRow[]> {
  const all = await db.documentAttachment.findMany({
    where: { ...scopeWhere(scope), docType, docId },
    orderBy: { uploadedAt: 'desc' },
  });
  // A replaced file stays on record behind the version that replaced it.
  const rows = all.filter((r) => !r.replacedById);
  const replacedBy = new Map(all.filter((r) => r.replacedById).map((r) => [r.replacedById as string, r.id]));
  const older = (id: string) => {
    let n = 0;
    let at = replacedBy.get(id);
    while (at && n < 50) { n += 1; at = replacedBy.get(at); }
    return n;
  };

  const ids = [...new Set(rows.map((r) => r.uploadedBy).filter((x): x is string => !!x))];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  // One signing call for the whole list, not one per file. If storage cannot
  // sign (not set up, or down), the files still list - unopenable - rather
  // than taking the whole document page down with them.
  const links = await signedUrls(rows.map((r) => r.storagePath)).catch(() => new Map<string, string>());

  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    url: links.get(r.storagePath) ?? null,
    label: r.label,
    uploadedAt: r.uploadedAt,
    uploadedByName: r.uploadedBy ? name.get(r.uploadedBy) ?? null : null,
    tag: r.tag,
    visibleToCustomer: r.visibleToCustomer,
    extracted: r.extracted && typeof r.extracted === 'object' && !Array.isArray(r.extracted)
      ? r.extracted as AttachmentRow['extracted']
      : null,
    olderVersions: older(r.id),
  }));
}

export interface CustomerFile {
  id: string;
  fileName: string;
  tag: string | null;
  mimeType: string;
  /** A short-lived signed link; null when storage could not sign it. */
  url: string | null;
}

/**
 * The files a customer may see on their documents (G5, 11 Oct 2026).
 *
 * "Customer sees it" used to reach only complaint photos. These are the same
 * rule for quotations, orders and invoices: marked visible, the current
 * version, not removed. Keyed `docType:docId`. `storeId` is the document's own
 * store - callers here are the no-login links and the portal, which have no
 * staff scope, so the store is the boundary.
 */
export async function customerFiles(
  storeId: string,
  docs: { docType: DocType; docId: string }[],
): Promise<Map<string, CustomerFile[]>> {
  const out = new Map<string, CustomerFile[]>();
  if (docs.length === 0) return out;
  const rows = await db.documentAttachment.findMany({
    where: {
      storeId, visibleToCustomer: true, replacedById: null, removedReason: null,
      OR: docs.map((d) => ({ docType: d.docType, docId: d.docId })),
    },
    orderBy: { uploadedAt: 'asc' },
    select: { id: true, docType: true, docId: true, fileName: true, tag: true, mimeType: true, storagePath: true },
  });
  if (rows.length === 0) return out;
  const links = await signedUrls(rows.map((r) => r.storagePath)).catch(() => new Map<string, string>());
  for (const r of rows) {
    const k = `${r.docType}:${r.docId}`;
    out.set(k, [...(out.get(k) ?? []), {
      id: r.id, fileName: r.fileName, tag: r.tag, mimeType: r.mimeType, url: links.get(r.storagePath) ?? null,
    }]);
  }
  return out;
}

/** An invoice's customer files, plus those on the order it came from (G5). */
export async function customerFilesForInvoice(invoiceId: string): Promise<CustomerFile[]> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { storeId: true, salesOrderId: true } });
  if (!inv) return [];
  const docs: { docType: DocType; docId: string }[] = [{ docType: 'invoice', docId: invoiceId }];
  if (inv.salesOrderId) docs.push({ docType: 'sales_order', docId: inv.salesOrderId });
  const m = await customerFiles(inv.storeId, docs);
  return docs.flatMap((d) => m.get(`${d.docType}:${d.docId}`) ?? []);
}

/** How many files each document carries, for the paperclip badge on a list. */
export async function countAttachments(
  scope: StoreScope,
  docType: DocType,
  docIds: string[],
): Promise<Map<string, number>> {
  if (docIds.length === 0) return new Map();
  const rows = await db.documentAttachment.groupBy({
    by: ['docId'],
    where: { ...scopeWhere(scope), docType, docId: { in: docIds }, replacedById: null },
    _count: { docId: true },
  });
  return new Map(rows.map((r) => [r.docId, r._count.docId]));
}

export async function addAttachment(
  scope: StoreScope,
  input: {
    docType: DocType;
    docId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    storagePath: string;
    label?: string | null;
    tag?: string | null;
    /** A newer version of this file (11 Oct 2026). The old one is kept behind it. */
    replaces?: string | null;
  },
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  const reason = rejectReason(input.mimeType, input.fileSize);
  if (reason) throw new Error(reason);

  const old = input.replaces
    ? await db.documentAttachment.findFirst({
      where: { id: input.replaces, storeId, docType: input.docType, docId: input.docId, replacedById: null },
      select: { id: true, tag: true, visibleToCustomer: true, label: true },
    })
    : null;
  if (input.replaces && !old) throw new Error('The file being replaced is not on this document any more.');

  return db.$transaction(async (tx) => {
    const row = await tx.documentAttachment.create({
      data: {
        storeId,
        docType: input.docType,
        docId: input.docId,
        fileName: input.fileName.slice(0, 200),
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        storagePath: input.storagePath,
        label: input.label?.trim() || old?.label || null,
        tag: cleanTag(input.tag) ?? old?.tag ?? DEFAULT_TAG[input.docType] ?? 'Other',
        // A job photo is for the customer unless someone makes it internal - the
        // portal has shown every job photo since F1a. Everything else starts internal.
        visibleToCustomer: old?.visibleToCustomer ?? (input.docType === 'complaint' && input.mimeType.startsWith('image/')),
        uploadedBy: userId,
      },
    });
    if (old) await tx.documentAttachment.update({ where: { id: old.id }, data: { replacedById: row.id } });
    return row;
  });
}

/** One live attachment, for the per-file actions (the caller checks the right for its docType). */
export async function findAttachment(scope: StoreScope, id: string) {
  return db.documentAttachment.findFirst({
    where: { id, ...scopeWhere(scope), replacedById: null },
    select: {
      id: true, storeId: true, docType: true, docId: true, fileName: true,
      mimeType: true, fileSize: true, storagePath: true, tag: true,
    },
  });
}

/** Change a file's tag, or whether the customer sees it (11 Oct 2026). */
export async function updateAttachment(
  scope: StoreScope, id: string, patch: { tag?: string; visibleToCustomer?: boolean },
) {
  const found = await findAttachment(scope, id);
  if (!found) throw new Error('That attachment is not in your scope.');
  const tag = patch.tag === undefined ? undefined : cleanTag(patch.tag);
  if (patch.tag !== undefined && !tag) throw new Error('Pick one of the listed tags.');
  return db.documentAttachment.update({
    where: { id: found.id },
    data: {
      ...(tag ? { tag } : {}),
      ...(patch.visibleToCustomer === undefined ? {} : { visibleToCustomer: !!patch.visibleToCustomer }),
      version: { increment: 1 },
    },
  });
}

/** Keep what the AI reader found on the file, so it is read once, not on every visit. */
export async function saveExtracted(scope: StoreScope, id: string, extracted: Record<string, unknown>) {
  const found = await findAttachment(scope, id);
  if (!found) throw new Error('That attachment is not in your scope.');
  await db.documentAttachment.update({
    where: { id: found.id },
    data: { extracted: extracted as Prisma.InputJsonValue, version: { increment: 1 } },
  });
}

/** The tags on a document's live files - what a Block rule is checked against. */
export async function tagsOn(storeId: string, docType: DocType, docId: string): Promise<(string | null)[]> {
  const rows = await db.documentAttachment.findMany({
    where: { storeId, docType, docId, replacedById: null },
    select: { tag: true },
  });
  return rows.map((r) => r.tag);
}

/**
 * What the document is worth (paise) - for "receipt over ₹50,000" rules and
 * for checking a read PO / payment amount against it. Zero when it has none.
 */
export async function documentAmountPaise(storeId: string, docType: DocType, docId: string): Promise<number> {
  const pick = { grandTotalPaise: true } as const;
  switch (docType) {
    case 'quotation': return (await db.quotation.findFirst({ where: { id: docId, storeId }, select: pick }))?.grandTotalPaise ?? 0;
    case 'sales_order': return (await db.salesOrder.findFirst({ where: { id: docId, storeId }, select: pick }))?.grandTotalPaise ?? 0;
    case 'invoice': return (await db.invoice.findFirst({ where: { id: docId, storeId }, select: pick }))?.grandTotalPaise ?? 0;
    case 'receipt': return (await db.receipt.findFirst({ where: { id: docId, storeId }, select: { amountPaise: true } }))?.amountPaise ?? 0;
    default: return 0;
  }
}

/** The file's bytes, for the AI reader. */
export async function attachmentBytes(storagePath: string): Promise<Uint8Array | null> {
  const url = (await signedUrls([storagePath])).get(storagePath);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * A file opened from a WhatsApp link (server/attachment-share). The token has
 * already proved which file and that it is in date; no session is involved -
 * the customer is not a user. Removed files and replaced versions do not open.
 */
export async function sharedFileUrl(id: string): Promise<string | null> {
  const row = await db.documentAttachment.findUnique({ where: { id }, select: { storagePath: true, replacedById: true } });
  if (!row || row.replacedById) return null;
  return (await signedUrls([row.storagePath])).get(row.storagePath) ?? null;
}

// ------------------------------------------------ Settings › Required documents

/** One key in StoreConfig.values, per branch - kept by saveStoreConfig (OWN_PAGE_KEYS). */
const REQUIRED_KEY = 'attachments.required';

export async function requiredRules(storeId: string): Promise<RequiredRule[]> {
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { values: true } });
  const v = row?.values && typeof row.values === 'object' && !Array.isArray(row.values)
    ? (row.values as Record<string, unknown>)[REQUIRED_KEY]
    : undefined;
  return v === undefined ? DEFAULT_REQUIRED : cleanRequired(v);
}

export async function requiredRulesFor(scope: StoreScope): Promise<RequiredRule[]> {
  return scope.kind === 'single' ? requiredRules(scope.storeId) : DEFAULT_REQUIRED;
}

export async function saveRequiredRules(scope: StoreScope, raw: unknown): Promise<RequiredRule[]> {
  const storeId = scopeForWrite(scope);
  const rules = cleanRequired(raw);
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { values: true } });
  const base = row?.values && typeof row.values === 'object' && !Array.isArray(row.values)
    ? row.values as Record<string, unknown>
    : {};
  const values = { ...base, [REQUIRED_KEY]: rules };
  await db.storeConfig.upsert({
    where: { storeId },
    create: { storeId, values: values as unknown as Prisma.InputJsonValue },
    update: { values: values as unknown as Prisma.InputJsonValue },
  });
  return rules;
}

export async function removeAttachment(
  scope: StoreScope, id: string, userId: string | null = null, reason: string | null = null,
) {
  const found = await db.documentAttachment.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('That attachment is not in your scope.');

  /**
   * Tombstoned, and since 11 Oct 2026 the FILE IS KEPT too, with the reason
   * typed. Pravin's rule for attachments: nothing is hard-deleted - a removed
   * customer PO or payment screenshot is exactly what an audit asks for later.
   * Removed files stop showing everywhere (reads skip tombstones), and after
   * F3 a tombstone cannot reappear from another machine.
   */
  await db.documentAttachment.update({
    where: { id: found.id },
    data: { deletedAt: new Date(), deletedBy: userId, removedReason: reason?.trim().slice(0, 300) || null },
  });
}
