/**
 * GST engine.
 *
 * Same state  -> CGST + SGST, split evenly.
 * Other state -> IGST.
 * Party state unknown -> IGST (matches the original's behaviour, which surfaces
 * "Customer state missing; IGST will apply").
 *
 * Wrong tax on an invoice is a legal problem, not a bug. This module has the
 * densest test coverage in the codebase.
 *
 * Spec: 03-technical-docs/01-specification/04-quotation.md §2.7
 */

/**
 * `NONE` is the GST toggle switched off (Vcare, 7 Oct 2026).
 *
 * A third mode rather than a separate boolean, because every document already
 * carries `taxMode` and every screen already reads it. A `gstEnabled` flag
 * beside it would be a second field that can disagree with the first, and the
 * first disagreement is an invoice showing tax it never charged.
 *
 * NONE is NOT "0% GST". Zero per cent is a rate somebody chose, and it prints.
 * NONE means the document does not deal in tax at all, and nothing about tax
 * appears on the customer's copy - no column, no HSN, no "Tax: 0" line.
 */
export type TaxMode = 'CGST_SGST' | 'IGST' | 'NONE';

/** True when this document shows nothing about tax at all. */
export const noTax = (mode: string): boolean => mode === 'NONE';

export interface TaxBreakdown {
  mode: TaxMode;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/**
 * Which GST applies, from the two states.
 *
 * Returns the NARROW type on purpose: this function answers "intra-state or
 * inter-state", and NONE is not an answer to that question. NONE comes from a
 * person pressing the toggle on a document, never from geography - which is
 * also why the purchase side can go on using this without ever having to think
 * about it. A supplier's bill carries whatever GST the supplier charged, and
 * Vcare cannot switch that off.
 */
export function resolveTaxMode(
  storeStateId: string,
  partyStateId: string | null | undefined,
): 'CGST_SGST' | 'IGST' {
  if (!partyStateId) return 'IGST';
  return partyStateId === storeStateId ? 'CGST_SGST' : 'IGST';
}

/**
 * @param taxableBasePaise line total AFTER line discount and order-level discount
 * @param ratePct total GST rate (e.g. 18 for 18%)
 */
export function computeTax(
  taxableBasePaise: number,
  ratePct: number,
  mode: TaxMode,
): TaxBreakdown {
  // NONE: no tax was charged, so there is nothing to split or report.
  if (mode === 'NONE') {
    return { mode, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  }

  const total = Math.round((taxableBasePaise * ratePct) / 100);

  if (mode === 'IGST') {
    return { mode, cgstPaise: 0, sgstPaise: 0, igstPaise: total, totalPaise: total };
  }

  // Split evenly; give any rounding remainder to CGST so the parts always sum.
  const half = Math.floor(total / 2);
  const cgst = total - half;
  return { mode, cgstPaise: cgst, sgstPaise: half, igstPaise: 0, totalPaise: total };
}
