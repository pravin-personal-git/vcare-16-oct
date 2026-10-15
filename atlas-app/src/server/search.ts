import 'server-only';
import { plainDocNo } from '@/lib/wa-message';
import { reachAnd, type SalesReach } from './sales-reach';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import type { SearchHit, ResultKind } from '@/lib/search-kinds';
import { UNIT_STATUS_LABEL, type UnitStatus } from '@/lib/stock-units';
import { RMA_STATUS_LABEL, type RmaStatus } from '@/lib/rma';

/**
 * Finding an actual record from the top bar.
 *
 * WHAT THIS IS FOR
 *
 * Somebody has a bill in their hand, or a customer on the phone, and needs the
 * record in two seconds. Not a report, not a filter - one thing, found by
 * whatever fragment they happen to know: a phone number, half a company name,
 * an invoice number, a supplier's own bill reference.
 *
 * WHY IT SEARCHES SIX TABLES AND NOT ONE
 *
 * The person searching does not know or care which screen a thing lives on.
 * "9827563406" is a customer to one person and a call log to another; "1184"
 * could be an invoice or a supplier's bill number. Making them pick the right
 * module first defeats the point of a search box.
 *
 * COST
 *
 * Small indexed queries, capped, run in ONE `$transaction` - the pooled
 * connection allows a single query at a time (`connection_limit=1`), so N
 * sequential awaits would be N round trips on every keystroke.
 */

/**
 * The kinds, their labels and their icons live in lib/search-kinds so the
 * client palette can import them too - this module is `server-only`. They were
 * declared in both places and drifted; see the note there.
 */
export {
  KIND_LABEL, KIND_ICON, type ResultKind, type SearchHit,
} from '@/lib/search-kinds';

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/**
 * Appends a migrated document's original reference to its subtitle, but only
 * when it differs from the number now on the document.
 *
 * For the Vcare import the two are usually identical - their numbers were kept
 * as-is - so showing both would print the same string twice on every row. It
 * differs in exactly the cases that matter: a repair challan whose source
 * document was split per product and carries a `-n` suffix, and anything later
 * renumbered into Atlas's own series.
 */
function withLegacyRef(subtitle: string, currentNo: string, legacyRef?: string | null): string {
  if (!legacyRef || legacyRef === currentNo) return subtitle;
  return subtitle ? `${subtitle} · was ${legacyRef}` : `was ${legacyRef}`;
}

/** Party display name - company first, because firms are usually companies. */
function partyName(p: {
  title?: string | null; firstName: string;
  lastName?: string | null; companyName?: string | null;
}): string {
  if (p.companyName?.trim()) return p.companyName.trim();
  return [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

/** Per-table cap. Enough to find the thing, few enough to stay fast. */
const PER_KIND = 5;

export async function globalSearch(
  scope: StoreScope,
  query: string,
  /** Whose quotations, orders and invoices this person sees (B4 step 3, server/sales-reach). */
  salesReach: SalesReach | null = null,
): Promise<SearchHit[]> {
  // A number copied out of WhatsApp carries non-breaking hyphens (lib/wa-message safeDocNo).
  const q = plainDocNo(query).trim();
  // Two characters matches half the database and helps nobody. Three is where
  // a search starts being a search rather than a listing.
  if (q.length < 3) return [];

  const like = { contains: q, mode: 'insensitive' as const };
  /**
   * Digits only, for phone matching - somebody typing "98275 63406" or
   * "+91 98275-63406" means the same number as the one stored.
   *
   * ONLY WHEN THE QUERY IS ACTUALLY A PHONE NUMBER (7 Oct 2026). It used to
   * strip every non-digit from anything, so a serial number lent its stray
   * digits to a phone search: `BFY5T4DOVPVW3C9G` became `5439`, and Atlas
   * answered a barcode with a customer called PRAKHAR GOLCHHA, whose number
   * is 97555**5439**9. Confidently wrong, which is worse than finding
   * nothing - somebody scanning a camera was shown a person.
   *
   * So the query has to look like a phone number: punctuation people really
   * type into one, and then digits. A single letter means it is a code.
   */
  const digits = /^[+\-() .]*[\d][\d+\-() .]*$/.test(q) ? q.replace(/\D/g, '') : '';
  const where = scopeWhere(scope);
  /**
   * A SERIAL FINDS EVERYTHING IT TOUCHED (15 Oct 2026).
   *
   * Typing a camera's serial found the unit and nothing else - not the
   * invoice it was billed on, not the customer who has it, not the challan
   * that took it to site, not the complaint raised on it. Those are exactly
   * what somebody with a serial in hand is after. So a query that looks like
   * a code (one word, letters or digits, 5+ characters - never a name with a
   * space, and never a phone number, which the `digits` rule above owns) is
   * also matched through the unit to each of them.
   */
  const code = !digits && /^[A-Za-z0-9][A-Za-z0-9\-/]{4,}$/.test(q) && /\d/.test(q);
  const bySerial = { serialNo: like };

  const [
    parties, invoices, bills, products, quotations, orders,
    leads, creditNotes, salesReturns, receipts, purchaseOrders, employees, tasks,
    complaints, repairChallans, installChallans, amcContracts, stockUnits, replacements,
    pickups, dispatches, rmaReceipts,
  ] = await db.$transaction([
    db.party.findMany({
      where: {
        ...where,
        OR: [
          { companyName: like },
          { firstName: like },
          { lastName: like },
          { partyCode: like },
          ...(digits.length >= 4
            ? [{ phone: { contains: digits } }, { altPhone: { contains: digits } }]
            : []),
          ...(code ? [{ heldUnits: { some: bySerial } }, { invoices: { some: { unitsSold: { some: bySerial } } } }] : []),
        ],
      },
      select: {
        id: true, title: true, firstName: true, lastName: true, companyName: true,
        partyCode: true, phone: true, isSupplier: true, isCustomer: true,
      },
      take: PER_KIND * 2,
    }),

    db.invoice.findMany({
      where: {
        ...where, ...reachAnd(salesReach),
        OR: [
          { invoiceNo: like },
          // The reference this document carried in the system it was migrated
          // from. A customer reads their old number down the phone; it has to
          // find the invoice whatever Atlas numbered it.
          { legacyRef: like },
          { customerName: like },
          { organizationName: like },
          { poNumber: like },
          ...(code ? [{ unitsSold: { some: bySerial } }] : []),
        ],
      },
      select: {
        id: true, invoiceNo: true, legacyRef: true, customerName: true, grandTotalPaise: true,
        amountPaidPaise: true, invoiceDate: true, lifecycle: true,
        // Which serial matched, so the row says why it is here.
        unitsSold: { where: bySerial, select: { serialNo: true }, take: 1 },
      },
      orderBy: { invoiceDate: 'desc' },
      take: PER_KIND,
    }),

    db.purchaseBill.findMany({
      where: {
        ...where,
        OR: [{ billNo: like }, { supplierBillNo: like }, { supplierName: like }],
      },
      select: {
        id: true, billNo: true, supplierBillNo: true, supplierName: true,
        grandTotalPaise: true, amountPaidPaise: true, billDate: true,
      },
      orderBy: { billDate: 'desc' },
      take: PER_KIND,
    }),

    db.product.findMany({
      where: {
        ...where,
        OR: [
          { productName: like }, { productCode: like },
          { barcode: like }, { sku: like }, { hsnCode: like },
        ],
      },
      select: { id: true, productName: true, productCode: true, unit: true, kind: true },
      take: PER_KIND,
    }),

    db.quotation.findMany({
      where: { ...where, ...reachAnd(salesReach), OR: [{ quotationNo: like }, { legacyRef: like }, { customerName: like }] },
      select: {
        id: true, quotationNo: true, legacyRef: true, customerName: true,
        grandTotalPaise: true, status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: PER_KIND,
    }),

    db.salesOrder.findMany({
      where: { ...where, ...reachAnd(salesReach), OR: [{ orderNo: like }, { legacyRef: like }, { customerName: like }] },
      select: {
        id: true, orderNo: true, legacyRef: true, customerName: true,
        grandTotalPaise: true, fulfilmentStatus: true,
      },
      orderBy: { orderDate: 'desc' },
      take: PER_KIND,
    }),

    db.lead.findMany({
      where: {
        ...where,
        OR: [
          { leadCode: like }, { businessName: like },
          { firstName: like }, { lastName: like },
          ...(digits.length >= 4 ? [{ mobile: { contains: digits } }] : []),
        ],
      },
      select: { id: true, leadCode: true, businessName: true, firstName: true, lastName: true, mobile: true },
      take: PER_KIND,
    }),

    db.creditNote.findMany({
      where: { ...where, OR: [{ creditNoteNo: like }, { customerName: like }] },
      select: { id: true, creditNoteNo: true, customerName: true, grandTotalPaise: true, lifecycle: true },
      orderBy: { creditNoteDate: 'desc' },
      take: PER_KIND,
    }),

    db.salesReturn.findMany({
      where: { ...where, OR: [{ returnNo: like }, { customerName: like }] },
      select: { id: true, returnNo: true, customerName: true, lifecycle: true },
      orderBy: { returnedAt: 'desc' },
      take: PER_KIND,
    }),

    db.receipt.findMany({
      where: { ...where, OR: [{ receiptNo: like }, { reference: like }] },
      select: { id: true, receiptNo: true, reference: true, amountPaise: true, method: true },
      orderBy: { receivedAt: 'desc' },
      take: PER_KIND,
    }),

    db.purchaseOrder.findMany({
      where: { ...where, OR: [{ orderNo: like }, { supplierName: like }] },
      select: { id: true, orderNo: true, supplierName: true, status: true },
      orderBy: { orderDate: 'desc' },
      take: PER_KIND,
    }),

    db.user.findMany({
      where: {
        storeRoles: { some: where },
        OR: [{ fullName: like }, { username: like }, { userCode: like }, { email: like }],
      },
      select: { id: true, fullName: true, userCode: true, email: true },
      take: PER_KIND,
    }),

    db.task.findMany({
      where: { ...where, title: like },
      select: { id: true, title: true, status: true, priority: true },
      take: PER_KIND,
    }),

    /**
     * Complaints. 3,548 rows for the migrated tenant, and the number a
     * customer reads down the phone.
     */
    db.complaint.findMany({
      where: {
        ...where,
        OR: [
          { complaintNo: like },
          { legacyRef: like },
          { description: like },
          // Their name, because "the complaint from Sharma Decoration" is how
          // people actually remember one.
          { customer: { companyName: like } },
          { customer: { firstName: like } },
          { customer: { lastName: like } },
          ...(code ? [{ items: { some: { OR: [bySerial, { stockUnit: bySerial }] } } }] : []),
        ],
      },
      select: {
        id: true, complaintNo: true, legacyRef: true, status: true,
        customer: { select: { firstName: true, lastName: true, companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: PER_KIND,
    }),

    /**
     * Repair challans. 6,819 rows, and the worst of the three omissions:
     * searching CCHN202602264 returned nothing while that very number was on
     * screen.
     *
     * `legacyRef` matters more here than anywhere else. One source challan
     * became one Atlas row per product, each suffixed `-1`, `-2`, so the
     * un-suffixed number on the client's paperwork exists ONLY in legacyRef.
     * Matching just `challanNo` is what made the reported search fail.
     */
    db.repairChallan.findMany({
      where: {
        ...where,
        OR: [
          { challanNo: like },
          { legacyRef: like },
          { physicalChallanNo: like },
          { complaint: { complaintNo: like } },
        ],
      },
      select: {
        id: true, challanNo: true, legacyRef: true, status: true, qty: true,
        product: { select: { productName: true } },
        complaint: {
          select: {
            complaintNo: true,
            customer: { select: { firstName: true, lastName: true, companyName: true } },
          },
        },
      },
      orderBy: { dispatchedAt: 'desc' },
      take: PER_KIND,
    }),

    /** Installation challans - `CHN...` slips, 203 rows. */
    db.installationChallan.findMany({
      where: {
        ...where,
        OR: [
          { challanNo: like },
          { legacyRef: like },
          { physicalChallanNo: like },
          { salesOrder: { orderNo: like } },
          { salesOrder: { customerName: like } },
          ...(code ? [{ items: { some: { OR: [{ barcode: like }, { stockUnit: bySerial }] } } }] : []),
        ],
      },
      select: {
        id: true, challanNo: true, legacyRef: true, status: true,
        salesOrder: { select: { orderNo: true, customerName: true } },
      },
      orderBy: { dispatchedAt: 'desc' },
      take: PER_KIND,
    }),

    /**
     * AMC contracts. Added with the module itself this time, rather than
     * discovered missing later - which is the whole point of this comment.
     */
    db.amcContract.findMany({
      where: {
        ...where,
        OR: [
          { contractNo: like },
          { legacyRef: like },
          { siteLabel: like },
          { customer: { companyName: like } },
          { customer: { firstName: like } },
          { customer: { lastName: like } },
        ],
      },
      select: {
        id: true, contractNo: true, legacyRef: true, status: true,
        endDate: true, amountPaise: true,
        customer: { select: { firstName: true, lastName: true, companyName: true } },
      },
      orderBy: { endDate: 'desc' },
      take: PER_KIND,
    }),

    /**
     * Serialised units, by serial. Added with the unit table (Phase 3). The
     * serial is the number a technician reads off a label on site, so it has
     * to be findable from the one box everybody already uses.
     */
    db.stockUnit.findMany({
      where: { ...where, serialNo: like },
      select: {
        id: true, serialNo: true, status: true,
        product: { select: { productName: true } },
        party: { select: { firstName: true, lastName: true, companyName: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: PER_KIND,
    }),

    /**
     * Replacement cases (Phase 6) - by case number, the old number, the
     * courier docket, or the serial. The docket is what a customer quotes
     * when they chase a unit.
     */
    db.replacementCase.findMany({
      where: {
        ...where,
        OR: [{ caseNo: like }, { legacyRef: like }, { docketNo: like }, { serialNo: like }, { productName: like }],
      },
      select: { id: true, caseNo: true, legacyRef: true, status: true, productName: true, docketNo: true },
      orderBy: { createdAt: 'desc' },
      take: PER_KIND,
    }),

    /**
     * The repair loop's own papers (10 Oct 2026, stage 5): pickup receipts,
     * supplier dispatches (by number, docket or the supplier's RMA number) and
     * RMA receipts. The docket and the supplier's number are what get quoted
     * on the phone.
     */
    db.itemPickup.findMany({
      where: { ...where, deletedAt: null, pickupNo: like },
      select: { id: true, pickupNo: true, complaintId: true, pickedUpAt: true, complaint: { select: { complaintNo: true } } },
      orderBy: { pickedUpAt: 'desc' },
      take: PER_KIND,
    }),
    db.supplierDispatch.findMany({
      where: { ...where, deletedAt: null, OR: [{ dispatchNo: like }, { docketNo: like }, { supplierRmaNo: like }] },
      select: { id: true, dispatchNo: true, status: true, docketNo: true, supplierName: true, serviceCentre: true, supplier: { select: { firstName: true, lastName: true, companyName: true } } },
      orderBy: { sentAt: 'desc' },
      take: PER_KIND,
    }),
    db.rmaReceipt.findMany({
      where: { ...where, deletedAt: null, OR: [{ receiptNo: like }, { docketNo: like }] },
      select: { id: true, receiptNo: true, receivedAt: true, supplierName: true, supplier: { select: { firstName: true, lastName: true, companyName: true } }, dispatch: { select: { dispatchNo: true } } },
      orderBy: { receivedAt: 'desc' },
      take: PER_KIND,
    }),
  ]);

  const hits: SearchHit[] = [];

  for (const p of parties.slice(0, PER_KIND * 2)) {
    const name = partyName(p);
    // A party can be both. Listed as whichever it primarily is, so the row
    // lands on the screen the user expects rather than the other one.
    const kind: ResultKind = p.isSupplier && !p.isCustomer ? 'supplier' : 'customer';
    hits.push({
      kind,
      id: p.id,
      title: name,
      subtitle: `${p.partyCode}${p.phone ? ` · ${p.phone}` : ''}`,
      // A customer has a real detail page; a supplier does not yet, so it
      // gets the search box seeded with its name instead of an unfiltered
      // list. Honest interim, and the link actually lands on the row.
      route: kind === 'supplier'
        ? `/suppliers?q=${encodeURIComponent(name)}`
        : `/customers/${p.id}`,
    });
  }

  for (const i of invoices) {
    const owed = Math.max(0, i.grandTotalPaise - i.amountPaidPaise);
    hits.push({
      kind: 'invoice',
      id: i.id,
      title: i.invoiceNo,
      subtitle: withLegacyRef(i.customerName, i.invoiceNo, i.legacyRef)
        + (i.unitsSold[0]?.serialNo ? ` · S/N ${i.unitsSold[0].serialNo}` : ''),
      meta: owed > 0 ? `${rupees(owed)} due` : rupees(i.grandTotalPaise),
      route: `/invoices/${i.id}`,
    });
  }

  for (const b of bills) {
    const owed = Math.max(0, b.grandTotalPaise - b.amountPaidPaise);
    hits.push({
      kind: 'bill',
      id: b.id,
      // THEIR number first. It is the one written on the paper in your hand.
      title: b.supplierBillNo,
      subtitle: `${b.supplierName} · ${b.billNo}`,
      meta: owed > 0 ? `${rupees(owed)} owed` : rupees(b.grandTotalPaise),
      route: `/purchase/bills/${b.id}`,
    });
  }

  for (const p of products) {
    hits.push({
      kind: 'product',
      id: p.id,
      title: p.productName,
      subtitle: `${p.productCode}${p.kind === 'service' ? ' · service' : ''}`,
      route: `/product-journey?product=${p.id}`,
    });
  }

  for (const l of leads) {
    const name = l.businessName?.trim() || [l.firstName, l.lastName].filter(Boolean).join(' ');
    hits.push({
      kind: 'lead',
      id: l.id,
      title: name,
      subtitle: `${l.leadCode}${l.mobile ? ` · ${l.mobile}` : ''}`,
      route: `/crm/leads?open=${l.id}`,
    });
  }

  for (const c of creditNotes) {
    hits.push({
      kind: 'creditNote',
      id: c.id,
      title: c.creditNoteNo,
      subtitle: c.customerName,
      meta: rupees(c.grandTotalPaise),
      route: `/credit-notes/${c.id}`,
    });
  }

  for (const sr of salesReturns) {
    hits.push({
      kind: 'salesReturn',
      id: sr.id,
      title: sr.returnNo,
      subtitle: sr.customerName,
      route: `/sales-return/${sr.id}`,
    });
  }

  for (const r of receipts) {
    hits.push({
      kind: 'receipt',
      id: r.id,
      title: r.receiptNo,
      subtitle: r.reference ? `Ref ${r.reference} · ${r.method}` : r.method,
      meta: rupees(r.amountPaise),
      route: `/receipts/${r.id}`,
    });
  }

  for (const po of purchaseOrders) {
    hits.push({
      kind: 'purchaseOrder',
      id: po.id,
      title: po.orderNo,
      subtitle: po.supplierName,
      route: `/purchase/orders/${po.id}`,
    });
  }

  for (const e of employees) {
    hits.push({
      kind: 'employee',
      id: e.id,
      title: e.fullName,
      subtitle: `${e.userCode}${e.email ? ` · ${e.email}` : ''}`,
      route: `/user/account?q=${encodeURIComponent(e.fullName)}`,
    });
  }

  for (const t of tasks) {
    hits.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      subtitle: `${t.status} · ${t.priority}`,
      // Opens the task itself (health check UX-3).
      route: `/tasks?open=${t.id}`,
    });
  }

  for (const q2 of quotations) {
    hits.push({
      kind: 'quotation',
      id: q2.id,
      title: q2.quotationNo,
      subtitle: withLegacyRef(q2.customerName, q2.quotationNo, q2.legacyRef),
      meta: rupees(q2.grandTotalPaise),
      route: `/quotation/${q2.id}`,
    });
  }

  for (const o of orders) {
    hits.push({
      kind: 'order',
      id: o.id,
      title: o.orderNo,
      subtitle: withLegacyRef(o.customerName, o.orderNo, o.legacyRef),
      meta: rupees(o.grandTotalPaise),
      route: `/sales/orders/${o.id}`,
    });
  }

  for (const c of complaints) {
    hits.push({
      kind: 'complaint',
      id: c.id,
      title: c.complaintNo,
      subtitle: withLegacyRef(partyName(c.customer), c.complaintNo, c.legacyRef),
      meta: c.status,
      // A REAL detail view, not a filtered list: the tracker opens one
      // complaint by id and shows its whole history.
      route: `/services/complaints/${c.id}`,
    });
  }

  for (const rc of repairChallans) {
    hits.push({
      kind: 'repairChallan',
      id: rc.id,
      title: rc.challanNo,
      subtitle: withLegacyRef(
        `${partyName(rc.complaint.customer)} · ${rc.product.productName}`
        + `${rc.qty > 1 ? ` x${rc.qty}` : ''}`,
        rc.challanNo,
        rc.legacyRef,
      ),
      meta: rc.status === 'legacy_unknown' ? undefined : rc.status,
      route: `/services/repairs/${rc.id}`,
    });
  }

  for (const ic of installChallans) {
    hits.push({
      kind: 'installationChallan',
      id: ic.id,
      title: ic.challanNo,
      subtitle: withLegacyRef(
        ic.salesOrder?.customerName ?? ic.salesOrder?.orderNo ?? 'No order',
        ic.challanNo,
        ic.legacyRef,
      ),
      meta: ic.status === 'legacy_unknown' ? undefined : ic.status,
      route: `/services/installations?q=${encodeURIComponent(ic.challanNo)}&open=${ic.id}`,
    });
  }

  for (const a of amcContracts) {
    hits.push({
      kind: 'amcContract',
      id: a.id,
      title: a.contractNo,
      subtitle: withLegacyRef(partyName(a.customer), a.contractNo, a.legacyRef),
      // The end date, because "is this customer still covered" is the question
      // somebody is asking when they look a contract up.
      meta: `${a.status} · to ${a.endDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`,
      route: `/services/amc?q=${encodeURIComponent(a.contractNo)}&open=${a.id}`,
    });
  }

  for (const u of stockUnits) {
    if (!u.serialNo) continue;
    hits.push({
      kind: 'stockUnit',
      id: u.id,
      title: u.serialNo,
      subtitle: u.product.productName,
      // Who holds it, because "where is this camera" is the question.
      meta: u.party ? `${UNIT_STATUS_LABEL[u.status as UnitStatus] ?? u.status} · ${partyName(u.party)}`
        : UNIT_STATUS_LABEL[u.status as UnitStatus] ?? u.status,
      route: `/stock-units?q=${encodeURIComponent(u.serialNo)}&open=${u.id}`,
    });
  }

  for (const r of replacements) {
    hits.push({
      kind: 'replacement',
      id: r.id,
      title: r.caseNo,
      subtitle: withLegacyRef(r.productName, r.caseNo, r.legacyRef),
      meta: `${RMA_STATUS_LABEL[r.status as RmaStatus] ?? r.status}${r.docketNo ? ` · docket ${r.docketNo}` : ''}`,
      route: `/services/replacements?q=${encodeURIComponent(r.caseNo)}&open=${r.id}`,
    });
  }

  for (const p of pickups) {
    hits.push({
      kind: 'pickup', id: p.id, title: p.pickupNo, subtitle: p.complaint.complaintNo,
      route: `/services/complaints/${p.complaintId}/pickup/${p.id}`,
    });
  }
  for (const d of dispatches) {
    hits.push({
      kind: 'supplierDispatch', id: d.id, title: d.dispatchNo,
      subtitle: (d.supplier ? partyName(d.supplier) : null) ?? d.supplierName ?? d.serviceCentre ?? '',
      meta: `${d.status.replace(/_/g, ' ')}${d.docketNo ? ` · docket ${d.docketNo}` : ''}`,
      route: `/services/dispatch/${d.id}`,
    });
  }
  for (const g of rmaReceipts) {
    hits.push({
      kind: 'rmaReceipt', id: g.id, title: g.receiptNo,
      subtitle: (g.supplier ? partyName(g.supplier) : null) ?? g.supplierName ?? '',
      meta: g.dispatch ? `back from ${g.dispatch.dispatchNo}` : undefined,
      route: `/services/dispatch/receipts/${g.id}`,
    });
  }

  /**
   * An exact match on a code or document number goes first.
   *
   * Somebody who typed a whole invoice number wants that invoice, not a
   * customer whose name happens to contain the digits. Everything else keeps
   * the order the queries returned, which is newest-first.
   */
  const lower = q.toLowerCase();
  return hits.sort((a, b) => {
    const aExact = a.title.toLowerCase() === lower ? 0 : 1;
    const bExact = b.title.toLowerCase() === lower ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = a.title.toLowerCase().startsWith(lower) ? 0 : 1;
    const bStarts = b.title.toLowerCase().startsWith(lower) ? 0 : 1;
    return aStarts - bStarts;
  });
}
