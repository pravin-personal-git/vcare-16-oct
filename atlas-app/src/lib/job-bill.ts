import { repairPricePaise } from './rma';

/**
 * WHAT A FIELD JOB BILLS (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 7).
 *
 * Built from the two switches, item by item, never from one "covered /
 * chargeable" label for the whole job:
 *
 * - THE TECHNICIAN (AMC): every visit at the visit charge while no AMC covers
 *   the site - pickup and refit are two visits (decision 3).
 * - THE PART / REPAIR (warranty): for each item whose warranty does not pay
 *   (expired, voided, or not ours) -
 *     - a supplier's repair: their charge plus the markup (decision 5);
 *     - a unit given from our stock in place of one the supplier kept: at the
 *       selling price;
 *     - its share of the courier, only when the business bills courier to the
 *       customer (Settings > Field jobs; default: we bear it).
 * - Parts the technician used on site (job challans): at the selling price when
 *   the job's parts are not free - unchanged from before.
 *
 * Pure, so the bill, the preview on the complaint and the close gate all give
 * the same answer, and the spec's acceptance tests are tests here.
 */

export interface BillLine {
  description: string;
  productCode: string | null;
  hsnCode: string | null;
  qty: number;
  /** Before GST. */
  unitPaise: number;
  taxRatePct: number;
  /** A part's product, so a bill the office changes still follows returns. */
  productId?: string | null;
}

export interface BillItem {
  equipmentName: string;
  serialNo: string | null;
  status: string;
  /** The warranty pays for this item's part / repair. */
  partsFree: boolean;
  /** The supplier's repair charge, when they quoted one. */
  supplierQuotePaise: number | null;
  /** This item's share of courier charges. */
  courierSharePaise: number;
}

export interface BillInput {
  /** The AMC sends the technician free. */
  labourFree: boolean;
  /** Visits made (not cancelled). */
  visits: number;
  visitChargePaise: number;
  markupPct: number;
  /** Bill each chargeable item's courier share to the customer. */
  courierToCustomer: boolean;
  items: BillItem[];
  /** Parts used on site, already filtered to what is billable. */
  parts: BillLine[];
  /** Units handed over from our stock, chargeable ones only (cost booked as parts consumed). */
  fromStock: BillLine[];
}

const named = (i: BillItem) => `${i.equipmentName}${i.serialNo ? ` (S/N ${i.serialNo})` : ''}`;

export function jobBillLines(b: BillInput): BillLine[] {
  const out: BillLine[] = [];
  if (!b.labourFree && b.visitChargePaise > 0 && b.visits > 0) {
    out.push({ description: 'Visit charge', productCode: null, hsnCode: null, qty: b.visits, unitPaise: b.visitChargePaise, taxRatePct: 18 });
  }
  out.push(...b.parts);
  for (const i of b.items) {
    if (i.status === 'cancelled' || i.partsFree) continue;
    if (i.supplierQuotePaise && i.supplierQuotePaise > 0) {
      out.push({ description: `Repair - ${named(i)}`, productCode: null, hsnCode: null, qty: 1, unitPaise: repairPricePaise(i.supplierQuotePaise, b.markupPct), taxRatePct: 18 });
    }
    if (b.courierToCustomer && i.courierSharePaise > 0) {
      out.push({ description: `Courier - ${named(i)}`, productCode: null, hsnCode: null, qty: 1, unitPaise: i.courierSharePaise, taxRatePct: 18 });
    }
  }
  out.push(...b.fromStock);
  return out.filter((l) => l.qty > 0 && l.unitPaise > 0);
}

/** Before GST, and with GST - for the preview and the close gate. */
export function billTotals(lines: BillLine[]): { basePaise: number; withGstPaise: number } {
  const basePaise = lines.reduce((s, l) => s + l.qty * l.unitPaise, 0);
  const withGstPaise = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPaise * (1 + l.taxRatePct / 100)), 0);
  return { basePaise, withGstPaise };
}
