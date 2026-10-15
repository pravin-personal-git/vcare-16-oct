import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import type { SalesDocType as DocType } from './attachments';

/**
 * Closing and reopening a sales document.
 *
 * The reference puts an Active / History toggle on every list screen. Closing
 * a document takes it out of the working list without destroying it - the
 * quotation that went nowhere, the order the customer walked away from.
 *
 * Two things this is deliberately NOT:
 *
 * 1. Not a status. An accepted quotation that gets closed is still an accepted
 *    quotation. If "closed" overwrote the status, the accepted count would drop
 *    and you could never find out what it used to be.
 *
 * 2. Not a delete. Deleting loses the document number, and a gap in a numbered
 *    sequence is the thing an auditor asks about first.
 */

const TABLE = {
  quotation: 'quotation',
  sales_order: 'salesOrder',
  invoice: 'invoice',
} as const;

/**
 * The three-row slice of a Prisma model this file actually uses.
 *
 * Spelled out rather than reached for with `Function`, which accepts anything
 * callable and would let a typo through to runtime. Quotation, SalesOrder and
 * Invoice have different shapes, so there is no shared generated type to lean
 * on - this is the narrowest honest description of what closing needs.
 */
interface DocModel {
  findFirst(args: {
    where: Record<string, unknown>;
    select: Record<string, boolean>;
  }): Promise<Record<string, unknown> | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
  delete(args: { where: { id: string } }): Promise<unknown>;
}

function model(docType: DocType): DocModel {
  return (db as unknown as Record<string, DocModel>)[TABLE[docType]];
}

export async function closeDocument(
  scope: StoreScope,
  docType: DocType,
  id: string,
  userId: string,
) {
  const m = model(docType);
  const found = await m.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true, closedAt: true } });
  if (!found) throw new Error('That document is not in your scope.');
  if (found.closedAt) throw new Error('That document is already closed.');
  return m.update({ where: { id }, data: { closedAt: new Date(), closedBy: userId } });
}

export async function reopenDocument(scope: StoreScope, docType: DocType, id: string) {
  const m = model(docType);
  const found = await m.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true } });
  if (!found) throw new Error('That document is not in your scope.');
  return m.update({ where: { id }, data: { closedAt: null, closedBy: null } });
}

/**
 * Hard delete, allowed only while a document is still a draft nobody has seen.
 *
 * Once a document has been sent, converted or paid against, deleting it is
 * always the wrong answer - close it instead. The guard lives here rather than
 * in the UI because a disabled menu item is a suggestion, not a rule.
 */
export async function deleteDocument(scope: StoreScope, docType: DocType, id: string) {
  const m = model(docType);

  if (docType === 'quotation') {
    const q = await db.quotation.findFirst({
      where: { id, ...scopeWhere(scope) },
      select: { status: true, quotationNo: true },
    });
    if (!q) throw new Error('That quotation is not in your scope.');
    if (q.status !== 'draft') {
      throw new Error(
        `${q.quotationNo} has already been sent. Close it instead - deleting leaves a gap in the number sequence, which is the first thing an auditor asks about.`,
      );
    }
  }

  if (docType === 'sales_order') {
    const o = await db.salesOrder.findFirst({
      where: { id, ...scopeWhere(scope) },
      select: { orderNo: true, fulfilmentStatus: true, amountPaidPaise: true, invoiceId: true },
    });
    if (!o) throw new Error('That order is not in your scope.');
    if (o.invoiceId) throw new Error(`${o.orderNo} has been invoiced. Cancel the invoice first.`);
    if (o.amountPaidPaise > 0) throw new Error(`${o.orderNo} has payments recorded against it. Close it instead.`);
    if (o.fulfilmentStatus !== 'booked') {
      throw new Error(`${o.orderNo} has already moved past Booked. Close it instead.`);
    }
  }

  if (docType === 'invoice') {
    const inv = await db.invoice.findFirst({
      where: { id, ...scopeWhere(scope) },
      select: { invoiceNo: true, lifecycle: true, amountPaidPaise: true },
    });
    if (!inv) throw new Error('That invoice is not in your scope.');
    if (inv.lifecycle !== 'draft') {
      throw new Error(
        `${inv.invoiceNo} has been issued. An issued invoice is a document in the customer's hands - cancel it instead, which leaves a record.`,
      );
    }
    if (inv.amountPaidPaise > 0) throw new Error(`${inv.invoiceNo} has payments against it.`);
  }

  /**
   * Attachments are not cascade-deleted by the database, because docId is a soft
   * reference. Clear them here or they become orphans nobody can find.
   *
   * Tombstoned rather than removed since 3 Oct 2026, and `deletedAt: null` is
   * explicit because an `updateMany` is not filtered automatically - without it,
   * deleting the same document twice would overwrite when each attachment
   * actually went.
   *
   * The FILE in storage is deliberately left alone. A tombstoned row still points
   * at it, and a restore that found its rows but not its files would be worse
   * than no restore at all.
   */
  await db.documentAttachment.updateMany({
    // Scoped as well as keyed on the document. The document itself was already
    // checked against this scope above, so `docId` alone would be correct - but
    // the store-scope coverage test reads call sites literally, and a filter a
    // test cannot see is a filter the next person can delete.
    where: { ...scopeWhere(scope), docType, docId: id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return m.delete({ where: { id } });
}

/** `where` clause for the Active / History toggle. */
export function archiveWhere(view: 'active' | 'history' | 'all') {
  if (view === 'active') return { closedAt: null };
  if (view === 'history') return { closedAt: { not: null } };
  return {};
}
