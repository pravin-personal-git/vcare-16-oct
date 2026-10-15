/**
 * Spreading money that has arrived across the invoices it settles.
 *
 * The reason this is its own module, and the reason the whole payment model is
 * being rebuilt around it: **the money that arrived and the invoices it settles
 * are two different facts.**
 *
 * A cheque for ₹1,00,000 is one event. That it clears INV-0007 and most of
 * INV-0008 is a decision - one that can be made later, corrected, or left
 * undone. Tying a payment to exactly one invoice, which is what the old model
 * did, made four ordinary things impossible to record:
 *
 *   - an advance, arriving before any invoice exists
 *   - one cheque against several invoices
 *   - money paid on account, to be applied later
 *   - TDS deducted at source, which settles an invoice without cash moving
 *
 * ALLOCATIONS ARE SIGNED AND APPEND-ONLY
 *
 * Un-applying money writes a negative row rather than deleting the original,
 * the same shape as `StockMovement`. Deleting would make a correction and a
 * mistake look identical afterwards, and with money that is the difference
 * between an error and a missing ₹40,000.
 *
 * Everything here is pure, so the rules can be tested without a database. The
 * hard parts are ordering and the two ceilings - an allocation may not exceed
 * what the receipt holds, nor what the invoice still owes - and both are easy
 * to get subtly wrong against real data.
 */

export interface AllocatableInvoice {
  id: string;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate: Date;
  grandTotalPaise: number;
  /** Already settled by earlier allocations. */
  paidPaise: number;
}

export interface Allocation {
  invoiceId: string;
  amountPaise: number;
}

export interface AutoAllocation {
  allocations: Allocation[];
  /** Money left over - an advance sitting on the customer's account. */
  unallocatedPaise: number;
}

/** What an invoice still owes. Never negative, even if it was overpaid. */
export function outstandingOn(inv: Pick<AllocatableInvoice, 'grandTotalPaise' | 'paidPaise'>): number {
  return Math.max(0, inv.grandTotalPaise - inv.paidPaise);
}

/**
 * Oldest debt first.
 *
 * By due date, not invoice date - the question being answered is "what is most
 * overdue", and an invoice raised later on shorter terms can genuinely fall due
 * first. Ties break on invoice date and then invoice number so that the same
 * inputs always produce the same allocation; without that last step two
 * equally-dated invoices could settle in either order and the customer's
 * statement would differ between two people looking at the same screen.
 */
export function oldestFirst(invoices: AllocatableInvoice[]): AllocatableInvoice[] {
  return [...invoices].sort(
    (a, b) =>
      a.dueDate.getTime() - b.dueDate.getTime()
      || a.invoiceDate.getTime() - b.invoiceDate.getTime()
      || a.invoiceNo.localeCompare(b.invoiceNo),
  );
}

/**
 * Spread an amount over the invoices it can settle, oldest first.
 *
 * This is what people actually want when they type in a payment - they are not
 * choosing invoices, they are clearing a debt. The result is a suggestion the
 * user can change, not a decision made for them.
 *
 * Fully-settled invoices are skipped rather than allocated zero, because a
 * zero-rupee allocation row records that nothing happened.
 */
export function autoAllocate(amountPaise: number, invoices: AllocatableInvoice[]): AutoAllocation {
  const allocations: Allocation[] = [];
  let left = Math.max(0, amountPaise);

  for (const inv of oldestFirst(invoices)) {
    if (left <= 0) break;
    const due = outstandingOn(inv);
    if (due <= 0) continue;

    const take = Math.min(left, due);
    allocations.push({ invoiceId: inv.id, amountPaise: take });
    left -= take;
  }

  return { allocations, unallocatedPaise: left };
}

/**
 * Net effect of signed allocation rows, per invoice.
 *
 * Rows are summed rather than taken one per invoice: a receipt may be applied
 * to an invoice, taken back, and applied again, and only the total is the
 * answer. Invoices whose rows cancel out to zero are dropped, so a caller
 * cannot mistake "applied and reversed" for "still applied".
 */
export function netAllocated(rows: Allocation[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const r of rows) {
    net.set(r.invoiceId, (net.get(r.invoiceId) ?? 0) + r.amountPaise);
  }
  for (const [id, n] of net) if (n === 0) net.delete(id);
  return net;
}

/** Of a receipt's total, how much is not yet applied to anything. */
export function unallocatedPaise(receiptAmountPaise: number, rows: Allocation[]): number {
  return receiptAmountPaise - rows.reduce((n, r) => n + r.amountPaise, 0);
}

/**
 * Everything wrong with a proposed allocation, in plain language.
 *
 * All problems are returned together rather than throwing on the first. Someone
 * splitting a payment across five invoices should not have to submit five times
 * to discover five mistakes.
 *
 * Duplicated invoices are summed, not rejected. The same invoice appearing
 * twice in one submission is a UI accident, and the honest reading of it is one
 * allocation of the combined amount - which is then checked like any other.
 */
export function validateAllocations(
  receiptAmountPaise: number,
  proposed: Allocation[],
  invoices: AllocatableInvoice[],
): string[] {
  const problems: string[] = [];
  const byId = new Map(invoices.map((i) => [i.id, i]));

  if (receiptAmountPaise <= 0) problems.push('Enter an amount greater than zero.');

  const merged = netAllocated(proposed);

  for (const [invoiceId, amountPaise] of merged) {
    const inv = byId.get(invoiceId);
    if (!inv) {
      problems.push('One of the invoices selected is not on this customer’s account.');
      continue;
    }
    if (amountPaise < 0) {
      problems.push(`${inv.invoiceNo}: an allocation cannot be negative.`);
      continue;
    }
    const due = outstandingOn(inv);
    if (amountPaise > due) {
      problems.push(
        `${inv.invoiceNo} only has ${rupees(due)} outstanding, but ${rupees(amountPaise)} is being applied to it.`
        + (due === 0 ? ' It is already settled.' : ''),
      );
    }
  }

  const total = [...merged.values()].reduce((n, v) => n + v, 0);
  if (total > receiptAmountPaise) {
    problems.push(
      `You are applying ${rupees(total)} but only ${rupees(receiptAmountPaise)} was received.`
      + ` Reduce the split by ${rupees(total - receiptAmountPaise)}.`,
    );
  }

  return problems;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
