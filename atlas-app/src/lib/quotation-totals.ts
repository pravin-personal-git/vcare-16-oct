/**
 * Quotation arithmetic. Pure, no database, no server-only marker - the form
 * recalculates live in the browser and the server recomputes before saving.
 * The client's numbers are never trusted; they are only for display.
 *
 * Order of operations matters and is fixed here once:
 *   1. line total   = qty × unit price
 *   2. line discount= line total × disc%
 *   3. taxable line = line total − line discount
 *   4. order discount is apportioned across lines by value
 *   5. GST is charged on the line AFTER both discounts
 *   6. delivery is added after tax, untaxed
 *
 * Charging GST before the order-level discount would overstate tax and is the
 * single most common way this goes wrong.
 *
 * Spec: 04-quotation.md §2.10
 */

export interface LineInput {
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;
}

export interface LineTotals {
  grossPaise: number;
  lineDiscountPaise: number;
  netPaise: number;
  apportionedDiscountPaise: number;
  taxablePaise: number;
  taxPaise: number;
}

export interface QuotationTotals {
  lines: LineTotals[];
  subtotalPaise: number;
  itemDiscountPaise: number;
  orderDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxTotalPaise: number;
  deliveryPaise: number;
  grandTotalPaise: number;
}

export function computeTotals(
  lines: LineInput[],
  opts: {
    /**
     * `NONE` is the GST toggle switched off - Vcare, 7 Oct 2026.
     *
     * A third mode rather than a separate flag, because every document in the
     * schema already carries `taxMode` and every screen already reads it. A
     * `gstEnabled` boolean beside it would mean two fields that can disagree,
     * and the first disagreement is an invoice that shows tax it did not
     * charge.
     *
     * NONE is not "0% GST". Zero per cent is a rate somebody chose and can be
     * shown; NONE means the document does not deal in tax at all, and nothing
     * about tax is printed. See the note where the totals are built.
     */
    taxMode: 'CGST_SGST' | 'IGST' | 'NONE';
    discountType: 'amount' | 'percent';
    discountValue: number;      // paise if amount, whole percent if percent
    deliveryPaise: number;
    deliveryExempt: boolean;
  },
): QuotationTotals {
  const gross = lines.map((l) => Math.round(l.qty * l.unitPricePaise));
  const lineDisc = lines.map((l, i) => Math.round((gross[i] * l.discountPct) / 100));
  const net = gross.map((g, i) => g - lineDisc[i]);

  const subtotal = gross.reduce((a, b) => a + b, 0);
  const itemDiscount = lineDisc.reduce((a, b) => a + b, 0);
  const netTotal = net.reduce((a, b) => a + b, 0);

  const orderDiscount = opts.discountType === 'percent'
    ? Math.round((netTotal * opts.discountValue) / 100)
    : Math.min(opts.discountValue, netTotal);

  // Apportion the order discount across lines by value, so each line is taxed
  // on what it actually contributes. Remainder goes to the largest line so the
  // parts always sum back to the whole.
  const apportioned = net.map((n) =>
    netTotal === 0 ? 0 : Math.round((orderDiscount * n) / netTotal),
  );
  const drift = orderDiscount - apportioned.reduce((a, b) => a + b, 0);
  if (drift !== 0 && apportioned.length > 0) {
    const biggest = net.indexOf(Math.max(...net));
    apportioned[biggest] += drift;
  }

  const taxable = net.map((n, i) => n - apportioned[i]);

  /**
   * NONE zeroes the tax here, at the one place it is worked out.
   *
   * Deliberately NOT by setting every line's rate to zero at the call site.
   * The rate on a line is what the product carries, and it stays true - if
   * somebody switches the toggle back on, the right tax comes back without
   * anybody having to remember what the rates were. Only the ANSWER is zero.
   */
  const tax = opts.taxMode === 'NONE'
    ? lines.map(() => 0)
    : lines.map((l, i) => Math.round((taxable[i] * l.taxRatePct) / 100));

  const taxTotal = tax.reduce((a, b) => a + b, 0);
  const taxableBase = taxable.reduce((a, b) => a + b, 0);

  // NONE leaves all three at zero - there is no split to make.
  let cgst = 0, sgst = 0, igst = 0;
  if (opts.taxMode === 'NONE') {
    // nothing
  } else if (opts.taxMode === 'IGST') {
    igst = taxTotal;
  } else {
    sgst = Math.floor(taxTotal / 2);
    cgst = taxTotal - sgst;         // remainder to CGST so the parts sum
  }

  const delivery = opts.deliveryExempt ? 0 : opts.deliveryPaise;

  return {
    lines: lines.map((_, i) => ({
      grossPaise: gross[i],
      lineDiscountPaise: lineDisc[i],
      netPaise: net[i],
      apportionedDiscountPaise: apportioned[i],
      taxablePaise: taxable[i],
      taxPaise: tax[i],
    })),
    subtotalPaise: subtotal,
    itemDiscountPaise: itemDiscount,
    orderDiscountPaise: orderDiscount,
    taxableBasePaise: taxableBase,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    taxTotalPaise: taxTotal,
    deliveryPaise: delivery,
    grandTotalPaise: taxableBase + taxTotal + delivery,
  };
}

export type QuotationStatus =
  | 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'expired';

export function isExpired(validUntil: Date, status: QuotationStatus, now = new Date()): boolean {
  return status === 'sent' && validUntil < now;
}
