/**
 * Returns and credit notes - the rules, without a database.
 *
 * Two ideas carry this whole module, and both exist because the obvious
 * implementation of each is subtly wrong against real data.
 *
 * 1. THE CUMULATIVE CAP
 *
 * You may not return more of an invoice line than was sold on it - counting
 * every earlier return, not just this one. The tempting shortcut is a
 * `returnedQty` column on the invoice line, incremented on each return. That is
 * the same stored-aggregate mistake that broke `Party.currentBalancePaise` and
 * `Invoice.amountPaidPaise`, and it fails in a specific way here: cancel a
 * return and the allowance stays consumed, so a customer who returned two items
 * by mistake can never return them properly. The cap is therefore always summed
 * from the return rows that still stand.
 *
 * 2. CREDIT IS A PROPORTION, NOT A UNIT PRICE
 *
 * A line of 7 at ₹1,000 with 12% off and a share of an order-level discount has
 * no clean per-unit taxable value. Rounding one and multiplying it by the
 * quantity strands paise on the invoice - individually trivial, collectively a
 * receivables report full of ₹3 balances nobody can close and nobody can
 * explain.
 *
 * So the credit for a return is the difference between two cumulative
 * proportions of the line's taxable value:
 *
 *     credit(before → after) = round(T × after / Q) − round(T × before / Q)
 *
 * Rounding the running total rather than each slice means the slices always sum
 * back to exactly T when the line is fully returned, no matter how many returns
 * it was split across or in what order. Part-returns cannot leave a remainder,
 * because the last one is defined as whatever is left.
 *
 * Pure - no database, no `server-only`. The browser shows the same figures the
 * server will write, computed by this same code.
 *
 * Spec: _archive/roadmap/NEXT-SPRINT.md weeks 2–4
 */

// ---------------------------------------------------------------- vocabulary

/**
 * What was done with the goods.
 *
 * Separate from whether the customer is owed money, deliberately. Tying the two
 * is how a shop ends up refusing a credit because the item came back broken -
 * which is exactly backwards, since a broken item is more the seller's problem,
 * not less.
 */
export type Disposition = 'restock' | 'damaged' | 'scrap';

export const DISPOSITIONS: { value: Disposition; label: string; hint: string }[] = [
  {
    value: 'restock',
    label: 'Back into stock',
    hint: 'Sellable. This is the only option that adds to stock.',
  },
  {
    value: 'damaged',
    label: 'Damaged',
    hint: 'Physically returned but not sellable. Recorded, not restocked.',
  },
  {
    value: 'scrap',
    label: 'Scrapped / not returned',
    hint: 'Destroyed, or written off without coming back at all.',
  },
];

/** Only good stock goes back on the shelf. The other two are recorded and held. */
export function movesStock(d: Disposition): boolean {
  return d === 'restock';
}

export type ReturnReason =
  | 'damaged_in_transit' | 'defective' | 'wrong_item' | 'excess_supply'
  | 'not_required' | 'quality_issue' | 'other';

export const RETURN_REASONS: { value: ReturnReason; label: string }[] = [
  { value: 'damaged_in_transit', label: 'Damaged in transit' },
  { value: 'defective', label: 'Defective / not working' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'excess_supply', label: 'Excess supplied' },
  { value: 'not_required', label: 'No longer required' },
  { value: 'quality_issue', label: 'Quality not as expected' },
  { value: 'other', label: 'Other' },
];

export type CreditReason =
  | 'goods_returned' | 'damage_allowance' | 'price_correction'
  | 'short_supply' | 'cancellation' | 'other';

export const CREDIT_REASONS: { value: CreditReason; label: string; hint: string }[] = [
  {
    value: 'goods_returned',
    label: 'Goods returned',
    hint: 'The customer sent items back.',
  },
  {
    value: 'damage_allowance',
    label: 'Damage allowance',
    hint: 'Money off for damaged goods the customer keeps. Nothing comes back.',
  },
  {
    value: 'price_correction',
    label: 'Price correction',
    hint: 'The invoice charged more than was agreed.',
  },
  {
    value: 'short_supply',
    label: 'Short supply',
    hint: 'Billed for more than was actually delivered.',
  },
  {
    value: 'cancellation',
    label: 'Order cancelled',
    hint: 'The whole supply was called off after invoicing.',
  },
  { value: 'other', label: 'Other', hint: '' },
];

export const RETURN_REASON_LABEL: Record<string, string> =
  Object.fromEntries(RETURN_REASONS.map((r) => [r.value, r.label]));

export const CREDIT_REASON_LABEL: Record<string, string> =
  Object.fromEntries(CREDIT_REASONS.map((r) => [r.value, r.label]));

export const DISPOSITION_LABEL: Record<string, string> =
  Object.fromEntries(DISPOSITIONS.map((d) => [d.value, d.label]));

/** A credit note with no goods behind it needs no return document. */
export function needsGoods(reason: CreditReason): boolean {
  return reason === 'goods_returned';
}

// --------------------------------------------------------------- the cap

export interface InvoiceLineForReturn {
  invoiceItemId: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  hsnCode: string | null;
  /** Quantity on the invoice line. */
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;
  /** Taxable value of the line - after line AND order-level discount. */
  taxablePaise: number;
  /** Already returned on live (non-cancelled) returns. */
  returnedQty: number;
}

/** How many of this line may still be sent back. Never negative. */
export function returnableQty(line: Pick<InvoiceLineForReturn, 'qty' | 'returnedQty'>): number {
  return Math.max(0, line.qty - line.returnedQty);
}

/**
 * Cumulative taxable credit after `n` units of a line have been returned.
 *
 * The rounding happens on the running total, never on a slice - that is what
 * makes part-returns sum back to exactly the line value. `n >= qty` returns the
 * whole line by definition rather than by arithmetic, so the final return
 * always closes the line out to the paise.
 */
export function creditedAfter(taxablePaise: number, qty: number, n: number): number {
  if (qty <= 0) return 0;
  if (n <= 0) return 0;
  if (n >= qty) return taxablePaise;
  return Math.round((taxablePaise * n) / qty);
}

/**
 * Taxable credit owed for returning `qty` more of a line.
 *
 * Takes what was already returned, because the credit for the same three units
 * genuinely differs depending on whether they are the first three or the last
 * three - the last ones carry the rounding remainder.
 */
export function creditForQty(
  line: Pick<InvoiceLineForReturn, 'qty' | 'taxablePaise' | 'returnedQty'>,
  qty: number,
): number {
  const before = Math.min(line.returnedQty, line.qty);
  const after = Math.min(before + Math.max(0, qty), line.qty);
  return creditedAfter(line.taxablePaise, line.qty, after)
    - creditedAfter(line.taxablePaise, line.qty, before);
}

export interface ProposedReturnLine {
  invoiceItemId: string;
  qty: number;
  disposition: Disposition;
}

/**
 * Everything wrong with a proposed return, in plain language, all at once.
 *
 * All problems together rather than throwing on the first, for the same reason
 * as `validateAllocations`: somebody returning six lines should not submit six
 * times to find six mistakes.
 */
export function validateReturn(
  proposed: ProposedReturnLine[],
  lines: InvoiceLineForReturn[],
): string[] {
  const problems: string[] = [];
  const byId = new Map(lines.map((l) => [l.invoiceItemId, l]));

  const withQty = proposed.filter((p) => p.qty > 0);
  if (withQty.length === 0) {
    problems.push('Enter a quantity against at least one line.');
  }

  // Summed, not rejected. The same line appearing twice is a UI accident, and
  // the honest reading is one return of the combined quantity - which is then
  // checked against the cap like anything else.
  const merged = new Map<string, number>();
  for (const p of withQty) {
    merged.set(p.invoiceItemId, (merged.get(p.invoiceItemId) ?? 0) + p.qty);
  }

  for (const [id, qty] of merged) {
    const line = byId.get(id);
    if (!line) {
      problems.push('One of the lines is not on this invoice.');
      continue;
    }
    if (!Number.isInteger(qty)) {
      problems.push(`${line.productName}: quantity must be a whole number.`);
      continue;
    }
    const canReturn = returnableQty(line);
    if (qty > canReturn) {
      problems.push(
        canReturn === 0
          ? `${line.productName}: all ${line.qty} have already been returned.`
          : `${line.productName}: only ${canReturn} of ${line.qty} can still be returned`
            + ` - ${line.returnedQty} came back earlier.`,
      );
    }
  }

  return problems;
}

// ------------------------------------------------------- credit note totals

export interface CreditLineInput {
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;
  /**
   * Taxable value of this credit line, worked out by the caller - from
   * `creditForQty` for a return, or entered directly for an allowance.
   *
   * Passed in rather than recomputed from qty × price because the two are not
   * the same number: the taxable value carries a share of the invoice's
   * order-level discount, which cannot be reconstructed from the line alone.
   */
  taxablePaise: number;
}

export interface CreditLineTotals {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
}

export interface CreditNoteTotals {
  lines: CreditLineTotals[];
  subtotalPaise: number;
  itemDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxTotalPaise: number;
  grandTotalPaise: number;
}

/**
 * GST on a credit note.
 *
 * `taxMode` is copied from the invoice and is not a choice. An IGST supply
 * credited as CGST+SGST claims back tax from two states that never received it,
 * and the mismatch surfaces months later as a GSTR-1 reconciliation failure
 * against the customer's GSTR-2B - by which point the return has been filed.
 *
 * The even split gives its remainder to CGST, matching `computeTax` in
 * server/gst.ts. Both halves must sum to the total or the credit note's own
 * arithmetic disagrees with the invoice it reverses.
 */
export function computeCreditTotals(
  lines: CreditLineInput[],
  taxMode: 'CGST_SGST' | 'IGST' | 'NONE',
): CreditNoteTotals {
  /*
    A CREDIT NOTE AGAINST A NO-GST INVOICE REFUNDS NO TAX (8 Oct 2026).

    This is a money bug, not a display one. The line still carries the
    product's rate - it always does, so the switch can be turned back on -
    and this function used to multiply by it regardless. On an invoice that
    charged no tax, the credit note would hand back CGST and SGST that was
    never collected, post it to the ledger and carry it into the GST return.

    `server/credit-notes` compounded it: `invoice.taxMode === 'IGST' ? 'IGST'
    : 'CGST_SGST'` turned NONE into an intra-state sale on the way in, so the
    mode never even arrived here. Both ends are fixed together.
  */
  const noTax = taxMode === 'NONE';
  const out: CreditLineTotals[] = lines.map((l) => {
    const grossPaise = Math.round(l.qty * l.unitPricePaise);
    return {
      grossPaise,
      discountPaise: grossPaise - l.taxablePaise,
      taxablePaise: l.taxablePaise,
      taxPaise: noTax ? 0 : Math.round((l.taxablePaise * l.taxRatePct) / 100),
    };
  });

  const subtotalPaise = out.reduce((n, l) => n + l.grossPaise, 0);
  const taxableBasePaise = out.reduce((n, l) => n + l.taxablePaise, 0);
  const taxTotalPaise = out.reduce((n, l) => n + l.taxPaise, 0);

  let cgstPaise = 0, sgstPaise = 0, igstPaise = 0;
  if (taxMode === 'IGST') {
    igstPaise = taxTotalPaise;
  } else {
    sgstPaise = Math.floor(taxTotalPaise / 2);
    cgstPaise = taxTotalPaise - sgstPaise;
  }

  return {
    lines: out,
    subtotalPaise,
    itemDiscountPaise: subtotalPaise - taxableBasePaise,
    taxableBasePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxTotalPaise,
    grandTotalPaise: taxableBasePaise + taxTotalPaise,
  };
}

// ------------------------------------------------------------ credit balance

/**
 * What a credit note still has available to apply or refund.
 *
 * Allocations are signed, so a taken-back allocation frees the credit again
 * simply by summing to less. Refunds only count while they stand - a reversed
 * refund (the transfer failed, the cheque bounced) puts the credit back, which
 * is the same rule receipts follow.
 */
export function unusedCreditPaise(
  grandTotalPaise: number,
  allocations: { amountPaise: number }[],
  refunds: { amountPaise: number; status: string }[],
): number {
  const allocated = allocations.reduce((n, a) => n + a.amountPaise, 0);
  const refunded = refunds
    .filter((r) => r.status === 'paid')
    .reduce((n, r) => n + r.amountPaise, 0);
  return grandTotalPaise - allocated - refunded;
}

// ----------------------------------------------------------- the GST deadline

/**
 * Whether a credit note is late enough that it may no longer reduce output tax.
 *
 * The CGST Act puts an outer limit on credit notes that reduce a supplier's tax
 * liability - broadly, tied to the November after the financial year of the
 * original supply, or the annual return, whichever comes first. After it, a
 * credit note can still be issued commercially, but the tax on it cannot be
 * recovered: the seller refunds the customer the full amount and absorbs the GST.
 *
 * ADVISORY ONLY, AND DELIBERATELY SO. Nothing here blocks a credit note. Two
 * reasons: the exact cut-off has moved with amendments and I could not verify
 * the current wording against a primary source when writing this, and a rule
 * that silently refuses a document at a year-end is worse than one that warns.
 * The month is a constant so a CA's answer is a one-line change.
 *
 * @see 00-recall/OPEN-QUESTIONS.md Q12 - needs a CA's confirmation.
 */
export const CREDIT_NOTE_CUTOFF_MONTH = 10; // November, zero-indexed.

/**
 * The FY of a supply runs 1 April → 31 March, so a supply made in Jan 2026
 * belongs to FY 2025-26 and its cut-off is November 2026.
 */
export function creditNoteCutoff(invoiceDate: Date): Date {
  const y = invoiceDate.getFullYear();
  const fyEndYear = invoiceDate.getMonth() >= 3 ? y + 1 : y;
  return new Date(fyEndYear, CREDIT_NOTE_CUTOFF_MONTH + 1, 0, 23, 59, 59, 999);
}

export function isPastTaxCutoff(invoiceDate: Date, creditNoteDate = new Date()): boolean {
  return creditNoteDate > creditNoteCutoff(invoiceDate);
}
