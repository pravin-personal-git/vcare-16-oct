import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * ONE PAGE PER DOCUMENT (G-29, 10 Oct 2026). Receipts, purchase orders,
 * goods receipts and supplier payments could only be seen as a row in a
 * list, so nothing could link to one - the document trail, a customer's
 * page and a search result all landed on the list instead. These are the
 * read-only views those links now open: what it is, who it is with, its
 * lines, and the documents on either side of it, each one a link.
 */

const party = (p: { companyName: string | null; firstName: string | null; lastName: string | null } | null) =>
  p ? (p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || '-') : '-';
const PARTY = { select: { id: true, companyName: true, firstName: true, lastName: true, phone: true } } as const;

export async function receiptView(scope: StoreScope, id: string) {
  const r = await db.receipt.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    include: {
      party: PARTY,
      salesOrder: { select: { id: true, orderNo: true } },
      challan: { select: { id: true, challanNo: true } },
      allocations: { where: { deletedAt: null }, orderBy: { allocatedAt: 'asc' }, select: { id: true, amountPaise: true, reason: true, allocatedAt: true, invoice: { select: { id: true, invoiceNo: true, grandTotalPaise: true } } } },
    },
  });
  if (!r) return null;
  const by = r.recordedBy ? await db.user.findUnique({ where: { id: r.recordedBy }, select: { fullName: true } }) : null;
  const applied = r.allocations.reduce((s, a) => s + a.amountPaise, 0);
  return { ...r, customerName: party(r.party), recordedByName: by?.fullName ?? null, appliedPaise: applied, onAccountPaise: Math.max(0, r.amountPaise - applied) };
}

export async function purchaseOrderView(scope: StoreScope, id: string) {
  const o = await db.purchaseOrder.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    include: {
      party: PARTY,
      items: { where: { deletedAt: null }, orderBy: { srNo: 'asc' } },
      goodsReceipts: { where: { deletedAt: null }, orderBy: { receivedDate: 'asc' }, select: { id: true, grnNo: true, receivedDate: true, status: true, supplierInvoiceNo: true } },
    },
  });
  if (!o) return null;
  // The supplier's bills for these deliveries: matched on their own invoice number, as product history does.
  const billNos = o.goodsReceipts.map((g) => g.supplierInvoiceNo).filter((x): x is string => !!x);
  const bills = billNos.length
    ? await db.purchaseBill.findMany({ where: { ...scopeWhere(scope), partyId: o.partyId, supplierBillNo: { in: billNos } }, select: { id: true, billNo: true, supplierBillNo: true } })
    : [];
  return { ...o, supplierLabel: party(o.party) || o.supplierName, bills };
}

export async function grnView(scope: StoreScope, id: string) {
  const g = await db.goodsReceiptNote.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    include: {
      party: PARTY,
      purchaseOrder: { select: { id: true, orderNo: true } },
      items: { where: { deletedAt: null }, orderBy: { srNo: 'asc' }, include: { units: { select: { id: true, serialNo: true }, take: LIST_MAX_ROWS } } },
    },
  });
  if (!g) return null;
  const bill = g.supplierInvoiceNo
    ? await db.purchaseBill.findFirst({ where: { ...scopeWhere(scope), partyId: g.partyId, supplierBillNo: g.supplierInvoiceNo }, select: { id: true, billNo: true } })
    : g.sourceBillId ? await db.purchaseBill.findFirst({ where: { id: g.sourceBillId, ...scopeWhere(scope) }, select: { id: true, billNo: true } }) : null;
  const by = g.createdBy ? await db.user.findUnique({ where: { id: g.createdBy }, select: { fullName: true } }) : null;
  return { ...g, supplierLabel: party(g.party) || g.supplierName, bill, createdByName: by?.fullName ?? null };
}

export async function supplierPaymentView(scope: StoreScope, id: string) {
  const p = await db.supplierPayment.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    include: {
      party: PARTY,
      allocations: { where: { deletedAt: null }, select: { id: true, amountPaise: true, bill: { select: { id: true, billNo: true, supplierBillNo: true, grandTotalPaise: true } } } },
    },
  });
  if (!p) return null;
  const by = p.recordedBy ? await db.user.findUnique({ where: { id: p.recordedBy }, select: { fullName: true } }) : null;
  const applied = p.allocations.reduce((s, a) => s + a.amountPaise, 0);
  return { ...p, supplierLabel: party(p.party), recordedByName: by?.fullName ?? null, appliedPaise: applied };
}

/**
 * ONE SUPPLIER (G-37, 10 Oct 2026). Pravin chose a page of its own, so a
 * supplier's name can open somewhere from every bill, order and receipt.
 * Read-only: who they are, what we owe them (the same `2100 Accounts
 * Payable` ledger the Supplier Account list reads), and every bill, order,
 * goods receipt, payment and return with them - each a link.
 */
export async function supplierView(scope: StoreScope, id: string) {
  const s = await db.party.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true, companyName: true,
      phoneCc: true, phone: true, email: true, gstin: true, addressLine1: true, city: true, state: true,
      status: true, isSupplier: true, isCustomer: true, createdAt: true,
    },
  });
  if (!s) return null;
  const [ap, bills, orders, grns, payments, returns] = await Promise.all([
    db.journalLine.aggregate({
      where: { account: { code: '2100' }, partyId: id, journalEntry: scopeWhere(scope) },
      _sum: { debitPaise: true, creditPaise: true },
    }),
    db.purchaseBill.findMany({
      where: { ...scopeWhere(scope), partyId: id, deletedAt: null }, orderBy: { billDate: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, billNo: true, supplierBillNo: true, billDate: true, dueDate: true, lifecycle: true, grandTotalPaise: true, amountPaidPaise: true },
    }),
    db.purchaseOrder.findMany({
      where: { ...scopeWhere(scope), partyId: id, deletedAt: null }, orderBy: { orderDate: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, orderNo: true, orderDate: true, status: true, grandTotalPaise: true },
    }),
    db.goodsReceiptNote.findMany({
      where: { ...scopeWhere(scope), partyId: id, deletedAt: null }, orderBy: { receivedDate: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, grnNo: true, receivedDate: true, status: true, supplierInvoiceNo: true },
    }),
    db.supplierPayment.findMany({
      where: { ...scopeWhere(scope), partyId: id, deletedAt: null }, orderBy: { paidAt: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, paymentNo: true, paidAt: true, amountPaise: true, method: true, status: true },
    }),
    db.purchaseReturn.findMany({
      where: { ...scopeWhere(scope), partyId: id, deletedAt: null }, orderBy: { returnedAt: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, returnNo: true, returnedAt: true, lifecycle: true },
    }),
  ]);
  const live = bills.filter((b) => b.lifecycle !== 'cancelled');
  return {
    ...s,
    name: party(s),
    contact: [s.title, s.firstName, s.lastName].filter(Boolean).join(' '),
    // What we owe them: credits to Accounts Payable less debits, for this party.
    payablePaise: (ap._sum.creditPaise ?? 0) - (ap._sum.debitPaise ?? 0),
    billedPaise: live.reduce((n, b) => n + b.grandTotalPaise, 0),
    paidPaise: payments.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amountPaise, 0),
    bills, orders, grns, payments, returns,
  };
}
