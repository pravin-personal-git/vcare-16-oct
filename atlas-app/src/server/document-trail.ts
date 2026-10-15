import 'server-only';
import { stageNamer } from './order-stages';
import { stageLabel } from '@/lib/installation-stages';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { storeOnlyConfig } from './config';

/**
 * The whole life of one sale, from any point in it.
 *
 * THE PROBLEM THIS SOLVES, WHICH IS NOT A DATA PROBLEM.
 *
 * Quotation → order → invoice → receipt has been linked in the database since
 * the beginning: an order carries its `quotationId`, an invoice its
 * `salesOrderId`, a receipt its allocations. Every join works.
 *
 * None of it is ever shown. Somebody looking at an invoice cannot see which
 * quotation it came from, whether it was ever paid, or that half of it came
 * back as a return - they have to go to three other screens and match numbers
 * by eye. The chain exists and is invisible, which for a user is the same as
 * not existing.
 *
 * So: no change to how documents are created, converted or stored. One read
 * that walks the chain, and one strip at the top of each document showing it.
 *
 * WALKS IN BOTH DIRECTIONS
 *
 * From an invoice you need to look backwards (which quotation?) and forwards
 * (was it paid? did anything come back?). Starting from any point, this
 * resolves the whole line - because "where am I in this sale" is the question,
 * and it does not have a direction.
 */

/**
 * THE SERVICE KINDS WERE ADDED 29 SEP 2026 (F1b, decision D18).
 *
 * The sales chain above shipped on two pages and stopped there. The half of the
 * product Vcare actually runs on - a complaint that produces a challan, a GDN
 * and then an invoice - had no strip at all: Pravin followed a complaint to its
 * invoice, saw a GDN had been created, clicked it, and landed on the
 * goods-dispatch LIST with no way back. The relations were all there; nothing
 * rendered them.
 *
 * A job joins the sales chain at `Complaint.invoiceId` (set by `billJob`), so
 * the service steps resolve first and then hand over to the existing walk.
 *
 * The kinds, labels and step shape live in lib/document-trail.ts - the strip is
 * rendered from client components too, and importing them from here would ship
 * `server-only` to the browser.
 */
export type { TrailKind, TrailStep } from '@/lib/document-trail';
import { KIND_LABEL, PURCHASE_KINDS, SERVICE_KINDS, type TrailKind, type TrailStep } from '@/lib/document-trail';
export { KIND_LABEL };

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

type Where = ReturnType<typeof scopeWhere>;

/**
 * Which job a service document belongs to.
 *
 * Every one of these carries `complaintId` already - `JobChallan` directly, a
 * GDN through its challan, a replacement optionally. Nothing new is stored;
 * this only reads what conversion already wrote.
 */
async function complaintIdFor(kind: TrailKind, id: string, where: Where): Promise<string | null> {
  if (kind === 'complaint') return id;

  if (kind === 'visit') {
    const v = await db.serviceVisit.findFirst({
      where: { id, ...where }, select: { complaintId: true },
    });
    return v?.complaintId ?? null;
  }
  if (kind === 'challan') {
    const c = await db.jobChallan.findFirst({
      where: { id, ...where }, select: { complaintId: true },
    });
    return c?.complaintId ?? null;
  }
  if (kind === 'gdn') {
    // A GDN is a MaterialIssue, which hangs off the challan, which hangs off
    // the job. This two-hop is the link that was never rendered.
    const g = await db.materialIssue.findFirst({
      where: { id, ...where }, select: { challan: { select: { complaintId: true } } },
    });
    return g?.challan.complaintId ?? null;
  }
  if (kind === 'replacement') {
    const r = await db.replacementCase.findFirst({
      where: { id, ...where }, select: { complaintId: true },
    });
    return r?.complaintId ?? null;
  }
  return null;
}

/**
 * Resolve the chain around one document.
 *
 * Deliberately tolerant: a sale raised directly as an invoice, with no
 * quotation and no order, is completely normal at a counter. Missing earlier
 * steps are simply absent rather than shown as gaps - a walk-in customer did
 * not skip a stage, there was never a stage to skip.
 */
export async function documentTrail(
  scope: StoreScope,
  kind: TrailKind,
  id: string,
): Promise<TrailStep[]> {
  // Switched off here rather than on each page (web.showDocumentTrail, F1a), so
  // the pages F1b adds later inherit the setting instead of each remembering to
  // ask. `DocumentTrail` already renders nothing for fewer than two steps.
  if (scope.kind === 'single' && !(await storeOnlyConfig(scope.storeId, 'web')).on('web.showDocumentTrail')) {
    return [];
  }

  const where = scopeWhere(scope);

  // The buying side is its own walk - see PURCHASE_KINDS in lib/document-trail.
  if (PURCHASE_KINDS.includes(kind)) return purchaseTrail(where, kind, id);

  // Anchor on the invoice wherever possible: it is the middle of the chain and
  // everything else hangs off it, so one lookup reaches both directions.
  let invoiceId: string | null = null;
  let orderId: string | null = null;
  let quotationId: string | null = null;

  // The service side resolves to a complaint first; a billed job then joins the
  // sales chain at `Complaint.invoiceId` and the walk below carries on as normal.
  let complaintId: string | null = null;
  if (SERVICE_KINDS.includes(kind)) {
    complaintId = await complaintIdFor(kind, id, where);
    if (!complaintId) return [];
    const job = await db.complaint.findFirst({
      where: { id: complaintId, ...where }, select: { invoiceId: true },
    });
    invoiceId = job?.invoiceId ?? null;
  }

  if (kind === 'invoice') {
    invoiceId = id;
  } else if (kind === 'order') {
    orderId = id;
  } else if (kind === 'installation') {
    // An installation joins the sales chain through its order (G1, 11 Oct 2026).
    const ic = await db.installationChallan.findFirst({
      where: { id, ...where }, select: { salesOrderId: true },
    });
    orderId = ic?.salesOrderId ?? null;
    if (!orderId) return [];
  } else if (kind === 'quotation') {
    quotationId = id;
  } else if (kind === 'return' || kind === 'credit_note') {
    const src = kind === 'return'
      ? await db.salesReturn.findFirst({ where: { id, ...where }, select: { invoiceId: true } })
      : await db.creditNote.findFirst({ where: { id, ...where }, select: { invoiceId: true } });
    invoiceId = src?.invoiceId ?? null;
  } else if (kind === 'receipt') {
    const alloc = await db.receiptAllocation.findFirst({
      where: { receiptId: id, ...where },
      select: { invoiceId: true },
    });
    invoiceId = alloc?.invoiceId ?? null;
  }

  // Walk backwards to fill in what we do not have yet.
  if (invoiceId && !orderId) {
    const inv = await db.invoice.findFirst({
      where: { id: invoiceId, ...where }, select: { salesOrderId: true },
    });
    orderId = inv?.salesOrderId ?? null;
  }
  if (orderId && !quotationId) {
    const so = await db.salesOrder.findFirst({
      where: { id: orderId, ...where }, select: { quotationId: true },
    });
    quotationId = so?.quotationId ?? null;
  }
  // And forwards, when we started before the invoice existed.
  if (!invoiceId && orderId) {
    const inv = await db.invoice.findFirst({
      where: { salesOrderId: orderId, ...where }, select: { id: true },
    });
    invoiceId = inv?.id ?? null;
  }
  if (!orderId && quotationId) {
    const so = await db.salesOrder.findFirst({
      where: { quotationId, ...where }, select: { id: true },
    });
    orderId = so?.id ?? null;
    if (orderId && !invoiceId) {
      const inv = await db.invoice.findFirst({
        where: { salesOrderId: orderId, ...where }, select: { id: true },
      });
      invoiceId = inv?.id ?? null;
    }
  }

  const [quotation, order, invoice, allocations, returns, notes] = await Promise.all([
    quotationId
      ? db.quotation.findFirst({
        where: { id: quotationId, ...where },
        select: { id: true, quotationNo: true, status: true, grandTotalPaise: true },
      })
      : null,
    orderId
      ? db.salesOrder.findFirst({
        where: { id: orderId, ...where },
        select: { id: true, orderNo: true, fulfilmentStatus: true, grandTotalPaise: true },
      })
      : null,
    invoiceId
      ? db.invoice.findFirst({
        where: { id: invoiceId, ...where },
        select: {
          id: true, invoiceNo: true, lifecycle: true,
          grandTotalPaise: true, amountPaidPaise: true,
        },
      })
      : null,
    invoiceId
      ? db.receiptAllocation.findMany({
        where: { invoiceId, ...where },
        select: {
          amountPaise: true,
          receipt: { select: { id: true, receiptNo: true, status: true } },
        },
      })
      : [],
    invoiceId
      ? db.salesReturn.findMany({
        where: { invoiceId, ...where },
        select: { id: true, returnNo: true, lifecycle: true },
      })
      : [],
    invoiceId
      ? db.creditNote.findMany({
        where: { invoiceId, ...where },
        select: { id: true, creditNoteNo: true, lifecycle: true, grandTotalPaise: true },
      })
      : [],
  ]);

  const steps: TrailStep[] = [];

  // ---- the service half, before the sale it turns into -------------------
  if (complaintId) {
    const job = await db.complaint.findFirst({
      where: { id: complaintId, ...where },
      select: {
        id: true, complaintNo: true, status: true, billingStatus: true,
        visits: {
          orderBy: { scheduledAt: 'asc' },
          select: { id: true, purpose: true, status: true, scheduledAt: true },
        },
        // Rejected challans are left out: they issued nothing and moved no
        // stock, so they are not part of what happened to this job.
        jobChallans: {
          where: { status: { not: 'rejected' } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, challanNo: true, status: true, type: true,
            issues: { select: { id: true, gdnNo: true, cancelledAt: true } },
          },
        },
        replacements: {
          orderBy: { caseNo: 'asc' },
          select: {
            id: true, caseNo: true, status: true,
            dispatch: { select: { id: true, dispatchNo: true, status: true } },
            receipt: { select: { id: true, receiptNo: true, receivedAt: true } },
          },
        },
        pickups: { orderBy: { pickedUpAt: 'asc' }, select: { id: true, pickupNo: true, pickedUpAt: true } },
      },
    });

    if (job) {
      steps.push({
        kind: 'complaint', id: job.id, label: job.complaintNo,
        detail: job.status.replace(/_/g, ' '),
        route: `/services/complaints/${job.id}`,
        current: kind === 'complaint' && job.id === id,
      });

      for (const v of job.visits) {
        steps.push({
          kind: 'visit', id: v.id, label: v.purpose.replace(/_/g, ' '),
          detail: `${v.status} · ${v.scheduledAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}`,
          // G-33: that visit, scrolled to and highlighted on the complaint page.
          route: `/services/complaints/${job.id}#visit-${v.id}`,
          current: kind === 'visit' && v.id === id,
        });
      }

      // A hand-back (stage 6) comes last, after the supplier's steps - below.
      for (const c of job.jobChallans.filter((x) => x.type !== 'handback')) {
        steps.push({
          kind: 'challan', id: c.id, label: c.challanNo,
          detail: `${c.type} · ${c.status.replace(/_/g, ' ')}`,
          route: `/services/complaints/${job.id}#challan-${c.id}`,
          current: kind === 'challan' && c.id === id,
        });

        /**
         * THE GDN. These are COMPLAINT GDNs, raised from a job challan, and
         * they have their own page under the dispatch register.
         *
         * Two live reports got this here. First it opened an unfiltered
         * register; then `?q=` searched the SALES-dispatch grid, which a
         * complaint GDN is not a row of, so it read "No dispatches match"
         * while the document sat visible further down the page. It now points
         * at the page the document actually lives on, with `gdn` naming the
         * row and the anchor scrolling to it.
         */
        for (const g of c.issues) {
            steps.push({
            kind: 'gdn', id: g.id, label: g.gdnNo,
            detail: g.cancelledAt ? 'cancelled' : 'issued',
            route: `/goods-dispatch/complaint-gdns?gdn=${encodeURIComponent(g.gdnNo)}#gdn-${encodeURIComponent(g.gdnNo)}`,
            current: kind === 'gdn' && g.id === id,
          });
        }
      }

      // The repair loop (10 Oct 2026): picked up, sent to the supplier in a box,
      // back on an RMA receipt. One box or receipt can carry several of this
      // job's items, so each is listed once.
      const short = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
      for (const p of job.pickups) {
        steps.push({
          kind: 'pickup', id: p.id, label: p.pickupNo, detail: `picked up · ${short(p.pickedUpAt)}`,
          route: `/services/complaints/${job.id}/pickup/${p.id}`, current: false,
        });
      }

      for (const r of job.replacements) {
        steps.push({
          kind: 'replacement', id: r.id, label: r.caseNo,
          detail: r.status.replace(/_/g, ' '),
          // The Replacements screen lives under Customer Service; `/replacements` was a 404.
          route: `/services/replacements?q=${encodeURIComponent(r.caseNo)}&open=${r.id}`,
          current: kind === 'replacement' && r.id === id,
        });
      }

      const boxes = new Map(job.replacements.flatMap((r) => (r.dispatch ? [[r.dispatch.id, r.dispatch] as const] : [])));
      for (const d of boxes.values()) {
        steps.push({
          kind: 'supplier_dispatch', id: d.id, label: d.dispatchNo, detail: d.status.replace(/_/g, ' '),
          route: `/services/dispatch/${d.id}`, current: false,
        });
      }
      const receipts = new Map(job.replacements.flatMap((r) => (r.receipt ? [[r.receipt.id, r.receipt] as const] : [])));
      for (const g of receipts.values()) {
        steps.push({
          kind: 'rma_receipt', id: g.id, label: g.receiptNo, detail: `received · ${short(g.receivedAt)}`,
          route: `/services/dispatch/receipts/${g.id}`, current: false,
        });
      }
      // Handed back to the customer (stage 6): the GDN they signed, on its own
      // printable page. Its job challan is plumbing and is not shown.
      for (const c of job.jobChallans.filter((x) => x.type === 'handback')) {
        for (const g of c.issues) {
          steps.push({
            kind: 'gdn', id: g.id, label: g.gdnNo, detail: 'handed back',
            route: `/services/complaints/${job.id}/handback/${g.id}`,
            current: kind === 'gdn' && g.id === id,
          });
        }
      }

      // The greyed step that does the work on the service side: a job finished
      // but never billed is the one people lose money on.
      if (!invoiceId && job.billingStatus !== 'not_billable') {
        steps.push({
          kind: 'invoice', id: '', label: 'Not billed yet',
          detail: 'bill the job when the work is done',
          route: `/services/complaints/${job.id}`, current: false, pending: true,
        });
      }
    }
  }

  if (quotation) {
    steps.push({
      kind: 'quotation', id: quotation.id, label: quotation.quotationNo,
      detail: `${quotation.status} · ${rupees(quotation.grandTotalPaise)}`,
      route: `/quotation/${quotation.id}`,
      current: kind === 'quotation' && quotation.id === id,
    });
  }

  if (order) {
    steps.push({
      kind: 'order', id: order.id, label: order.orderNo,
      detail: `${(await stageNamer(scope))(order.fulfilmentStatus)} · ${rupees(order.grandTotalPaise)}`,
      // G-27: the order itself, not the list filtered to it.
      route: `/sales/orders/${order.id}`,
      current: kind === 'order' && order.id === id,
    });

    // Its installations, each to its own page (G1, 11 Oct 2026). One order can
    // have several - one per site or per set of lines. Deleted ones are left
    // out by the soft-delete filter; a sent-back one is still part of the story.
    const installs = await db.installationChallan.findMany({
      where: { salesOrderId: order.id, ...where },
      orderBy: { dispatchedAt: 'asc' },
      select: { id: true, challanNo: true, stage: true },
    });
    for (const ic of installs) {
      steps.push({
        kind: 'installation', id: ic.id, label: ic.challanNo,
        detail: stageLabel(ic.stage),
        route: `/services/installations/${ic.id}`,
        current: kind === 'installation' && ic.id === id,
      });
    }
  }

  if (invoice) {
    const owed = Math.max(0, invoice.grandTotalPaise - invoice.amountPaidPaise);
    steps.push({
      kind: 'invoice', id: invoice.id, label: invoice.invoiceNo,
      detail: owed > 0
        ? `${rupees(owed)} still due of ${rupees(invoice.grandTotalPaise)}`
        : `settled · ${rupees(invoice.grandTotalPaise)}`,
      route: `/invoices/${invoice.id}`,
      current: kind === 'invoice' && invoice.id === id,
    });
  }

  // Reversed receipts are shown, struck through on screen. A payment that
  // bounced is part of the story of the sale, and hiding it means somebody
  // rings the customer without knowing they already tried to pay.
  for (const a of allocations) {
    steps.push({
      kind: 'receipt', id: a.receipt.id, label: a.receipt.receiptNo,
      detail: a.receipt.status === 'reversed'
        ? `${rupees(a.amountPaise)} · reversed`
        : rupees(a.amountPaise),
      route: `/receipts/${a.receipt.id}`,
      current: kind === 'receipt' && a.receipt.id === id,
    });
  }

  for (const r of returns) {
    steps.push({
      kind: 'return', id: r.id, label: r.returnNo,
      detail: r.lifecycle,
      route: `/sales-return/${r.id}`,
      current: kind === 'return' && r.id === id,
    });
  }

  for (const n of notes) {
    steps.push({
      kind: 'credit_note', id: n.id, label: n.creditNoteNo,
      detail: `${n.lifecycle} · ${rupees(n.grandTotalPaise)}`,
      route: `/credit-notes/${n.id}`,
      current: kind === 'credit_note' && n.id === id,
    });
  }

  /**
   * The next step that has not happened yet, when there is an obvious one.
   *
   * This is the part that makes the strip useful rather than decorative: it
   * answers "what now?" without the user having to know the process. An order
   * with no invoice is waiting to be invoiced; an invoice still owed is waiting
   * for money. Both are shown greyed, as a destination rather than a fact.
   */
  if (order && !invoice) {
    steps.push({
      kind: 'invoice', id: '', label: 'Not invoiced yet',
      detail: 'convert the order when the goods go out',
      route: '/sales/orders', current: false, pending: true,
    });
  } else if (invoice) {
    const owed = invoice.grandTotalPaise - invoice.amountPaidPaise;
    if (owed > 0 && allocations.length === 0) {
      steps.push({
        kind: 'receipt', id: '', label: 'Not paid yet',
        detail: `${rupees(owed)} outstanding`,
        route: '/receipts', current: false, pending: true,
      });
    }
  }

  return steps;
}

/**
 * The buying side: purchase order → goods receipt → supplier bill → payment,
 * with purchase returns after the bill.
 *
 * Anchored on the BILL, for the same reason the selling side anchors on the
 * invoice: it is the document money hangs off, and both directions reach from
 * it. The joins are thinner than on the sales side and that is a fact about
 * the data, not an omission here - a purchase bill records what a supplier
 * charged, and a business that receives goods with the bill in the box never
 * raises a purchase order at all. Missing earlier steps are simply absent.
 */
async function purchaseTrail(where: Where, kind: TrailKind, id: string): Promise<TrailStep[]> {
  let billId: string | null = null;
  let grnId: string | null = null;
  let poId: string | null = null;

  if (kind === 'bill') billId = id;
  else if (kind === 'goods_receipt') grnId = id;
  else if (kind === 'purchase_order') poId = id;
  else if (kind === 'purchase_return') {
    const r = await db.purchaseReturn.findFirst({ where: { id, ...where }, select: { billId: true } });
    billId = r?.billId ?? null;
  } else if (kind === 'supplier_payment') {
    const a = await db.supplierPaymentAllocation.findFirst({
      where: { paymentId: id, ...where }, select: { billId: true },
    });
    billId = a?.billId ?? null;
  }

  // A GRN carries its purchase order, and - only when this app created the
  // receipt itself behind a bill with no PO - the bill it came from.
  if (grnId) {
    const g = await db.goodsReceiptNote.findFirst({
      where: { id: grnId, ...where }, select: { purchaseOrderId: true, sourceBillId: true },
    });
    poId = poId ?? g?.purchaseOrderId ?? null;
    billId = billId ?? g?.sourceBillId ?? null;
  }
  if (poId && !grnId) {
    const g = await db.goodsReceiptNote.findFirst({
      where: { purchaseOrderId: poId, ...where }, select: { id: true, sourceBillId: true },
    });
    grnId = g?.id ?? null;
    billId = billId ?? g?.sourceBillId ?? null;
  }
  if (billId && !grnId) {
    const g = await db.goodsReceiptNote.findFirst({
      where: { sourceBillId: billId, ...where }, select: { id: true, purchaseOrderId: true },
    });
    grnId = g?.id ?? null;
    poId = poId ?? g?.purchaseOrderId ?? null;
  }

  const [po, grn, bill, allocations, returns] = await Promise.all([
    poId ? db.purchaseOrder.findFirst({
      where: { id: poId, ...where },
      select: { id: true, orderNo: true, status: true, grandTotalPaise: true },
    }) : null,
    grnId ? db.goodsReceiptNote.findFirst({
      where: { id: grnId, ...where },
      select: { id: true, grnNo: true, status: true, supplierName: true },
    }) : null,
    billId ? db.purchaseBill.findFirst({
      where: { id: billId, ...where },
      select: { id: true, billNo: true, lifecycle: true, grandTotalPaise: true, amountPaidPaise: true },
    }) : null,
    billId ? db.supplierPaymentAllocation.findMany({
      where: { billId, ...where },
      select: { amountPaise: true, payment: { select: { id: true, paymentNo: true, status: true } } },
    }) : [],
    billId ? db.purchaseReturn.findMany({
      where: { billId, ...where },
      select: { id: true, returnNo: true, lifecycle: true },
    }) : [],
  ]);

  const steps: TrailStep[] = [];

  if (po) {
    steps.push({
      kind: 'purchase_order', id: po.id, label: po.orderNo,
      detail: `${po.status.replace(/_/g, ' ')} · ${rupees(po.grandTotalPaise)}`,
      route: `/purchase/orders/${po.id}`,
      current: kind === 'purchase_order' && po.id === id,
    });
  }

  if (grn) {
    steps.push({
      kind: 'goods_receipt', id: grn.id, label: grn.grnNo,
      detail: `${grn.status.replace(/_/g, ' ')} · ${grn.supplierName}`,
      route: `/goods-receipt/${grn.id}`,
      current: kind === 'goods_receipt' && grn.id === id,
    });
  }

  if (bill) {
    const owed = Math.max(0, bill.grandTotalPaise - bill.amountPaidPaise);
    steps.push({
      kind: 'bill', id: bill.id, label: bill.billNo,
      detail: owed > 0
        ? `${rupees(owed)} still owed of ${rupees(bill.grandTotalPaise)}`
        : `settled · ${rupees(bill.grandTotalPaise)}`,
      route: `/purchase/bills/${bill.id}`,
      current: kind === 'bill' && bill.id === id,
    });
  }

  // Reversed payments are shown, like reversed receipts on the sales side: a
  // payment that bounced is part of the story, and hiding it means somebody
  // pays a supplier twice.
  for (const a of allocations) {
    steps.push({
      kind: 'supplier_payment', id: a.payment.id, label: a.payment.paymentNo,
      detail: a.payment.status === 'reversed' ? `${rupees(a.amountPaise)} · reversed` : rupees(a.amountPaise),
      route: `/purchase/payments/${a.payment.id}`,
      current: kind === 'supplier_payment' && a.payment.id === id,
    });
  }

  for (const r of returns) {
    steps.push({
      kind: 'purchase_return', id: r.id, label: r.returnNo,
      detail: r.lifecycle,
      route: `/purchase-return?q=${encodeURIComponent(r.returnNo)}&open=${r.id}`,
      current: kind === 'purchase_return' && r.id === id,
    });
  }

  // The greyed step that does the work on this side: a bill nobody has paid.
  if (bill) {
    const owed = bill.grandTotalPaise - bill.amountPaidPaise;
    if (owed > 0 && allocations.length === 0) {
      steps.push({
        kind: 'supplier_payment', id: '', label: 'Not paid yet',
        detail: `${rupees(owed)} owed to the supplier`,
        route: '/purchase/payables', current: false, pending: true,
      });
    }
  }

  return steps;
}
