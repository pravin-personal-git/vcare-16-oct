import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * One physical item's whole life, in order (1 Oct 2026).
 *
 * THE QUESTION THIS ANSWERS.
 *
 * Somebody types a serial number or an in-house id and wants, at a glance:
 * who we bought it from and when, what we paid, when it reached the shelf,
 * who we sold it to, on what date, to which site, what they paid, and
 * everything that has happened to it since.
 *
 * The pieces already existed - `getUnitDetail` returns the supplier, the GRN,
 * the sale invoice, the install challan, complaints and a full event log. Two
 * things were missing, and they are the two the question actually turns on:
 *
 *   1. THE MONEY. What it cost, what it sold for, what that leaves, and
 *      whether either side has actually been paid. A trail that shows
 *      documents but not money answers "where is it" and not "how did we do".
 *   2. THE SITE. A customer is a company; the item sits at an address. For a
 *      service business that address is how an engineer finds it.
 *
 * This module adds those and arranges everything as a sequence of stages, so
 * the screen can draw a journey instead of a form.
 */

export type StageKind = 'bought' | 'received' | 'billed' | 'paid_out' | 'sold' | 'delivered' | 'installed' | 'serviced' | 'returned';

export interface JourneyStage {
  kind: StageKind;
  /** What happened, in words a person would use. */
  title: string;
  /** Who it involved. */
  party: string | null;
  at: Date | null;
  /** The document, if there is one. */
  docNo: string | null;
  docHref: string | null;
  /** Money moving at this stage. Negative is out, positive is in. */
  amountPaise: number | null;
  /** Shown under the title - a site address, a note, a status. */
  detail: string | null;
  /** Something is unfinished here: unpaid, undelivered, open complaint. */
  open: boolean;
}

export interface ProductJourney {
  unitId: string;
  serialNo: string | null;
  /** The model this unit is one of, so a `?unit=` link can also show it. */
  productId: string;
  productName: string;
  productCode: string | null;
  status: string;
  condition: string;

  /** What we paid, what we got, and the difference. Nulls where unknown. */
  money: {
    costPaise: number | null;
    soldPaise: number | null;
    marginPaise: number | null;
    /** True when we still owe the supplier for it. */
    weOwe: boolean;
    /** True when the customer still owes us. */
    theyOwe: boolean;
  };

  /** Where it physically is now, in one line. */
  whereItIs: string;

  stages: JourneyStage[];
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/**
 * Find a unit by serial number or in-house id.
 *
 * Both, because a technician reads whichever is printed on the thing in front
 * of them and should not have to know which one Atlas calls it.
 */
export async function findUnitForJourney(
  scope: StoreScope, query: string,
): Promise<{ id: string; serialNo: string | null; productName: string }[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db.stockUnit.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [
        { serialNo: { contains: q, mode: 'insensitive' } },
        { legacyRef: { contains: q, mode: 'insensitive' } },
        { id: q },
      ],
    },
    take: LIST_MAX_ROWS,
    orderBy: { receivedAt: 'desc' },
    select: { id: true, serialNo: true, product: { select: { productName: true } } },
  });

  return rows.map((r) => ({
    id: r.id, serialNo: r.serialNo, productName: r.product.productName,
  }));
}

export async function productJourney(
  scope: StoreScope, unitId: string,
): Promise<ProductJourney | null> {
  const unit = await db.stockUnit.findFirst({
    where: { id: unitId, ...scopeWhere(scope) },
    select: {
      id: true, serialNo: true, status: true, condition: true,
      partyId: true, productId: true,
      unitCostPaise: true, receivedAt: true, note: true,
      product: { select: { productName: true, productCode: true } },
      party: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      invoice: {
        select: {
          id: true, invoiceNo: true, invoiceDate: true,
          grandTotalPaise: true, amountPaidPaise: true,
        },
      },
      grnItem: {
        select: {
          id: true,
          grn: {
            select: {
              id: true, grnNo: true, receivedDate: true, supplierName: true,
              supplierInvoiceNo: true, purchaseOrderId: true,
              purchaseOrder: { select: { id: true, orderNo: true, orderDate: true } },
            },
          },
        },
      },
    },
  });
  if (!unit) return null;

  const partyName = unit.party
    ? (unit.party.companyName || [unit.party.firstName, unit.party.lastName].filter(Boolean).join(' '))
    : null;

  /**
   * The supplier's bill for this delivery.
   *
   * Matched on the supplier's own invoice number, because that is what links a
   * GRN to the bill the accounts team entered - a receipt and a bill are
   * raised by different people, often days apart, and nothing else reliably
   * ties them together.
   */
  const supplierBillNo = unit.grnItem?.grn.supplierInvoiceNo ?? null;
  const bill = supplierBillNo
    ? await db.purchaseBill.findFirst({
      where: { ...scopeWhere(scope), supplierBillNo },
      select: {
        id: true, billNo: true, billDate: true,
        grandTotalPaise: true, amountPaidPaise: true,
      },
    }).catch(() => null)
    : null;

  /**
   * Service calls for this unit.
   *
   * A Complaint carries a product and a customer, never a serial number - so
   * "this exact unit" cannot be asked directly. The match is the same one the
   * existing unit screen uses: this customer, this product, raised after they
   * took delivery. It is right whenever a customer holds one of a product,
   * which is almost always, and it is stated on screen rather than implied.
   */
  // Since 10 Oct 2026 a complaint names its items by serial - those are exact,
  // and found even when the unit is away for repair (no holder on it then).
  const complaints = await db.complaint.findMany({
      where: {
        ...scopeWhere(scope),
        OR: [
          { items: { some: { stockUnitId: unit.id, deletedAt: null } } },
          ...(unit.partyId ? [{
            customerId: unit.partyId,
            productId: unit.productId,
            ...(unit.invoice ? { createdAt: { gte: unit.invoice.invoiceDate } } : {}),
          }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: FEED_MAX_ROWS,
      select: {
        id: true, complaintNo: true, status: true, createdAt: true, description: true,
        site: { select: { name: true, address: true } },
      },
    }).catch(() => []);

  const stages: JourneyStage[] = [];

  // ---- bought ----------------------------------------------------------
  const po = unit.grnItem?.grn.purchaseOrder;
  if (po) {
    stages.push({
      kind: 'bought',
      title: 'Ordered from the supplier',
      party: unit.grnItem?.grn.supplierName ?? null,
      at: po.orderDate,
      docNo: po.orderNo,
      docHref: `/purchase/orders/${po.id}`,
      amountPaise: null,
      detail: null,
      open: false,
    });
  }

  // ---- received --------------------------------------------------------
  if (unit.grnItem) {
    const grn = unit.grnItem.grn;
    stages.push({
      kind: 'received',
      title: 'Received into stock',
      party: grn.supplierName,
      at: grn.receivedDate,
      docNo: grn.grnNo,
      docHref: `/goods-receipt/${grn.id}`,
      amountPaise: unit.unitCostPaise !== null ? -unit.unitCostPaise : null,
      detail: grn.supplierInvoiceNo ? `Their bill ${grn.supplierInvoiceNo}` : null,
      open: false,
    });
  } else {
    stages.push({
      kind: 'received',
      title: 'Entered into stock',
      party: null,
      at: unit.receivedAt,
      docNo: null,
      docHref: null,
      amountPaise: unit.unitCostPaise !== null ? -unit.unitCostPaise : null,
      // Said plainly: an opening-balance or hand-entered unit has no purchase
      // behind it, and that is not an error.
      detail: 'No purchase document - entered by hand or carried in from an opening balance',
      open: false,
    });
  }

  // ---- billed and paid out --------------------------------------------
  if (bill) {
    const outstanding = bill.grandTotalPaise - bill.amountPaidPaise;
    stages.push({
      kind: 'billed',
      title: 'Supplier billed us',
      party: unit.grnItem?.grn.supplierName ?? null,
      at: bill.billDate,
      docNo: bill.billNo,
      docHref: `/purchase/bills?q=${encodeURIComponent(bill.billNo)}`,
      amountPaise: null,
      detail: outstanding > 0
        ? `${rupees(outstanding)} of this bill still unpaid`
        : 'Paid in full',
      open: outstanding > 0,
    });
  }

  // ---- sold ------------------------------------------------------------
  if (unit.invoice) {
    const owed = unit.invoice.grandTotalPaise - unit.invoice.amountPaidPaise;
    stages.push({
      kind: 'sold',
      title: 'Sold',
      party: partyName,
      at: unit.invoice.invoiceDate,
      docNo: unit.invoice.invoiceNo,
      docHref: `/invoices/${unit.invoice.id}`,
      amountPaise: unit.invoice.grandTotalPaise,
      detail: owed > 0
        ? `${rupees(owed)} still to collect on this invoice`
        : 'Paid in full',
      open: owed > 0,
    });
  }

  // ---- serviced --------------------------------------------------------
  for (const c of complaints) {
    const where = c.site
      ? [c.site.name, c.site.address].filter(Boolean).join(', ')
      : null;
    const done = ['closed', 'cancelled'].includes(c.status);
    stages.push({
      kind: 'serviced',
      title: done ? 'Service call closed' : 'Service call open',
      party: partyName,
      at: c.createdAt,
      docNo: c.complaintNo,
      docHref: `/services/complaints/${c.id}`,
      amountPaise: null,
      detail: [where, c.description?.slice(0, 80)].filter(Boolean).join(' · ') || null,
      open: !done,
    });
  }

  stages.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  const costPaise = unit.unitCostPaise ?? null;
  const soldPaise = unit.invoice?.grandTotalPaise ?? null;

  return {
    unitId: unit.id,
    serialNo: unit.serialNo,
    productId: unit.productId,
    productName: unit.product.productName,
    productCode: unit.product.productCode,
    status: unit.status,
    condition: unit.condition,
    money: {
      costPaise,
      soldPaise,
      // Null rather than a guess: "margin 0" and "we do not know the cost" are
      // different sentences, and only one is a claim about the business.
      marginPaise: costPaise !== null && soldPaise !== null ? soldPaise - costPaise : null,
      weOwe: bill ? bill.grandTotalPaise > bill.amountPaidPaise : false,
      theyOwe: unit.invoice ? unit.invoice.grandTotalPaise > unit.invoice.amountPaidPaise : false,
    },
    whereItIs: partyName
      ? `With ${partyName}`
      : unit.status === 'in_stock' ? 'In the store' : unit.status.replace(/_/g, ' '),
    stages,
  };
}
