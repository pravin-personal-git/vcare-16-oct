/**
 * Purchase arithmetic - pure, no database, no clock.
 *
 * The buy side of the same rules the sell side already follows: integer paise
 * throughout, nothing rounded until it has to be, and no total ever stored that
 * could be derived. Three production bugs in this product came from stored
 * aggregates, and a payables ledger is the worst place to add a fourth - a
 * wrong receivable is an awkward conversation, a wrong payable is paying twice.
 */

export interface BillLineInput {
  qty: number;
  /** Excluding tax, before discount. */
  unitCostPaise: number;
  /** 0–100. */
  discountPct: number;
  /** Total GST rate, e.g. 18. */
  taxRatePct: number;
}

export interface BillLineTotals {
  grossPaise: number;
  lineDiscountPaise: number;
  /** After discount. This is what tax is charged on. */
  taxablePaise: number;
}

/**
 * One line, before any bill-level charge is spread across it.
 *
 * The discount is rounded once, at the line, and the taxable value is the
 * subtraction - not a second independent rounding. Rounding twice lets the
 * parts disagree with the whole by a paisa, which is invisible until a supplier
 * queries a bill and nobody can reproduce the number.
 */
export function lineTotals(line: BillLineInput): BillLineTotals {
  const qty = Math.max(0, Math.trunc(line.qty));
  const gross = qty * Math.max(0, Math.trunc(line.unitCostPaise));
  const pct = Math.min(100, Math.max(0, line.discountPct));
  const discount = Math.round((gross * pct) / 100);

  return {
    grossPaise: gross,
    lineDiscountPaise: discount,
    taxablePaise: gross - discount,
  };
}

export interface BillTotals {
  subtotalPaise: number;
  itemDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
  /** Per line, in the order given, after freight has been apportioned. */
  lines: (BillLineTotals & { freightSharePaise: number; taxPaise: number })[];
}

/**
 * A whole bill.
 *
 * FREIGHT IS APPORTIONED ACROSS THE LINES, NOT ADDED AT THE END.
 *
 * A supplier charging ₹500 delivery on a bill of three products has added ₹500
 * to the cost of those goods. Bolting it onto the total instead would mean:
 *
 *   - the cost of each product is understated, so every margin computed from it
 *     is overstated - the error lands in the profit figure, in the flattering
 *     direction, which is the direction nobody checks
 *   - the tax base is wrong, because freight on a taxable supply is taxable
 *
 * Apportioned by taxable value, which is the ordinary treatment. Weight would
 * be more truthful for freight specifically, and this product does not know
 * what anything weighs.
 *
 * The remainder from the division goes to the LAST line, so the apportioned
 * shares always sum exactly to the freight charged.
 */
export function computeBillTotals(
  lines: BillLineInput[],
  freightPaise: number,
  mode: 'CGST_SGST' | 'IGST',
): BillTotals {
  const base = lines.map(lineTotals);

  const subtotal = base.reduce((n, l) => n + l.grossPaise, 0);
  const itemDiscount = base.reduce((n, l) => n + l.lineDiscountPaise, 0);
  const taxableBeforeFreight = base.reduce((n, l) => n + l.taxablePaise, 0);

  const freight = Math.max(0, Math.trunc(freightPaise));

  // Apportion. When every line is worth nothing there is nothing to apportion
  // by, so it goes on the last line rather than being silently dropped.
  const shares: number[] = new Array(base.length).fill(0);
  if (freight > 0 && base.length > 0) {
    if (taxableBeforeFreight > 0) {
      let assigned = 0;
      for (let i = 0; i < base.length - 1; i++) {
        const share = Math.round((freight * base[i].taxablePaise) / taxableBeforeFreight);
        shares[i] = share;
        assigned += share;
      }
      shares[base.length - 1] = freight - assigned;
    } else {
      shares[base.length - 1] = freight;
    }
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  const out = base.map((l, i) => {
    const withFreight = l.taxablePaise + shares[i];
    const total = Math.round((withFreight * lines[i].taxRatePct) / 100);

    if (mode === 'IGST') {
      igst += total;
    } else {
      // Split evenly, remainder to CGST, matching `computeTax` in gst.ts so the
      // two never disagree by a paisa on the same figures.
      const half = Math.floor(total / 2);
      cgst += total - half;
      sgst += half;
    }

    return { ...l, freightSharePaise: shares[i], taxPaise: total };
  });

  const taxableBase = taxableBeforeFreight + freight;

  return {
    subtotalPaise: subtotal,
    itemDiscountPaise: itemDiscount,
    taxableBasePaise: taxableBase,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    grandTotalPaise: taxableBase + cgst + sgst + igst,
    lines: out,
  };
}

/**
 * The landed unit cost of a line - what this thing actually cost us.
 *
 * Freight included, tax excluded. Tax is excluded because input GST is
 * reclaimed: a business paying ₹118 for a ₹100 item with 18% GST has a stock
 * item costing ₹100, not ₹118, and treating the tax as cost understates every
 * margin in the product.
 *
 * Returns 0 for a zero-quantity line rather than dividing by zero.
 */
export function landedUnitCostPaise(
  taxablePaise: number,
  freightSharePaise: number,
  qty: number,
): number {
  const q = Math.trunc(qty);
  if (q <= 0) return 0;
  return Math.round((taxablePaise + freightSharePaise) / q);
}

// ------------------------------------------------------------ settlement

export interface Payable {
  id: string;
  grandTotalPaise: number;
  paidPaise: number;
}

/** What is still owed on a bill. Never negative. */
export function outstandingPaise(bill: Payable): number {
  return Math.max(0, bill.grandTotalPaise - bill.paidPaise);
}

/**
 * Spread a payment across bills, oldest first.
 *
 * OLDEST FIRST IS A DEFAULT, NOT A RULE. The caller may allocate by hand, and
 * the screen lets them - a supplier chasing one specific bill wants that bill
 * settled, not the oldest. This exists so the common case is one click.
 *
 * Never allocates more than a bill is owed, and never more than the payment
 * holds. Anything left over comes back as `unallocatedPaise`, which is a real
 * and ordinary state - an advance to a supplier is money paid against nothing
 * yet, and refusing to record it would send people back to their notebooks.
 */
export function allocateOldestFirst(
  bills: Payable[],
  amountPaise: number,
): { allocations: { billId: string; amountPaise: number }[]; unallocatedPaise: number } {
  let left = Math.max(0, Math.trunc(amountPaise));
  const allocations: { billId: string; amountPaise: number }[] = [];

  for (const bill of bills) {
    if (left <= 0) break;
    const owed = outstandingPaise(bill);
    if (owed <= 0) continue;

    const take = Math.min(owed, left);
    allocations.push({ billId: bill.id, amountPaise: take });
    left -= take;
  }

  return { allocations, unallocatedPaise: left };
}

export type BillStatus = 'draft' | 'unpaid' | 'part_paid' | 'paid' | 'overdue' | 'cancelled';

/**
 * What a bill's status IS, derived every time.
 *
 * Never stored. The status of a bill is a fact about its lifecycle, its total,
 * what has been paid and today's date - four things that change independently,
 * and a stored status goes stale the moment any of them moves. "Overdue" in
 * particular is a fact about the calendar: a bill becomes overdue while nobody
 * is looking at it, and no write happens at that moment to update a column.
 */
export function billStatus(
  bill: Payable & { lifecycle: string; dueDate: Date },
  now: Date,
): BillStatus {
  if (bill.lifecycle === 'cancelled') return 'cancelled';
  if (bill.lifecycle === 'draft') return 'draft';

  const owed = outstandingPaise(bill);
  if (owed === 0) return 'paid';

  // Overdue outranks part-paid: a bill half paid and three weeks late is a
  // problem, and calling it "part paid" buries that.
  if (bill.dueDate.getTime() < now.getTime()) return 'overdue';

  return bill.paidPaise > 0 ? 'part_paid' : 'unpaid';
}

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  draft: 'Draft',
  unpaid: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

/** How late, in days. Zero when not yet due. */
export function daysOverdue(dueDate: Date, now: Date): number {
  const ms = now.getTime() - dueDate.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * Standard payables ageing buckets.
 *
 * The point of ageing is to answer "how bad is this?" at a glance, and the
 * conventional 30/60/90 split is what an accountant will expect to see.
 */
export type AgeBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export function ageBucket(dueDate: Date, now: Date): AgeBucket {
  const d = daysOverdue(dueDate, now);
  if (d === 0) return 'current';
  if (d <= 30) return 'd1_30';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

export const AGE_BUCKET_LABEL: Record<AgeBucket, string> = {
  current: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};
