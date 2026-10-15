'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  listAmcContracts, getAmcContractDetail, createAmcContract, updateAmcContract,
  setAmcStatus, renewAmcContract, raiseAmcInvoice, AmcError,
  type AmcContractInput, type AmcStatus,
} from '@/server/amc';
import { parseTaxRatePct, parseSacCode } from '@/lib/amc-tax';
import { friendlyError } from '@/lib/friendly-error';
import { istDayStart } from '@/lib/date-ranges';

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

function refresh() {
  revalidatePath('/services/amc');
  revalidatePath('/services/complaints');
  revalidatePath('/services/complaints', 'layout');
}

/**
 * READING coverage is gated on `complaints.view`; WRITING a contract on
 * `customers.edit`. Two different permissions on purpose.
 *
 * Measured against the migrated tenant's real roles: `complaints.*` is held by
 * all seven roles and so by all 22 staff, including 13 technicians and 5
 * helpers. `customers.edit` is held by Admin, HOD, Senior Manager and Manager
 * - 8 people.
 *
 * That split is the correct one for this module. A technician about to leave
 * for a site MUST be able to see whether the customer holds cover, or the
 * feature does not do its job. But an AMC has a price and a renewal date: it
 * is a commercial agreement with a customer, not service-desk paperwork, and
 * thirteen technicians should not be able to create, reprice or cancel one.
 *
 * Reusing two existing permissions rather than inventing `amc.view`/`amc.edit`
 * is deliberate. A new key needs rows in Permission, RolePermission for every
 * role, and RoleMenuConfig - and a missing RoleMenuConfig row resolves to
 * false, which is exactly how all six Vcare roles ended up with a blank
 * sidebar earlier in this migration. Two keys that already land on precisely
 * the right two populations are worth more than a tidier name.
 */
async function guardWrite(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('amc.edit')) {
      return { error: 'Only a manager can create or change a maintenance contract.' };
    }
    await run();
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof AmcError) return { error: err.message };
    console.error('[amc] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function loadAmcContractsAction(status?: string) {
  const ctx = await requireContext();
  return listAmcContracts(ctx.scope, { status });
}

export async function loadAmcContractDetailAction(id: string) {
  const ctx = await requireContext();
  return getAmcContractDetail(ctx.scope, id);
}

/*
 * There was a `resolveCoverageAction` here. Deleted 24 Sep 2026, unused.
 *
 * The Complaint Tracker gets coverage bundled into
 * `loadComplaintDetailAction` (services/actions.ts), which is one network
 * round trip instead of two on the slowest screen in the app. This action was
 * a second way to ask the same question that nothing ever called - and a
 * second path to a coverage answer is a second place for it to drift.
 */

/**
 * Dates arrive as `YYYY-MM-DD` strings from the form's date inputs.
 *
 * Parsed with an explicit midnight rather than `new Date('2026-04-01')`, which
 * ECMAScript parses as UTC midnight - in IST (+05:30) that is 05:30 on the
 * 1st, and for anyone west of Greenwich it is the PREVIOUS day. A contract
 * silently starting or ending a day early is the kind of off-by-one that only
 * shows up in an argument about a service call.
 */
function parseDay(value: string): Date {
  // ...but "explicit midnight" was the SERVER's midnight, UTC on Vercel - 05:30
  // India time. Midnight India time now (9 Oct 2026). A bad value stays an
  // Invalid Date, which server/amc refuses with a message.
  return istDayStart(value) ?? new Date(Number.NaN);
}

export interface AmcFormInput {
  customerId: string;
  siteLabel: string | null;
  invoiceId: string | null;
  startDate: string;
  endDate: string;
  amountPaise: number;
  coverageTerms: string;
  visitsIncluded: number | null;
  reminderDays: number;
  notes: string | null;
  legacyRef: string | null;
  /**
   * The GST rate and SAC exactly as typed, blank included.
   *
   * Strings rather than numbers so that blank stays blank all the way to the
   * server: a number input coerces blank to 0, and "nobody entered a rate"
   * silently becoming "zero-rated" is the one mistake this field must not
   * make. `parseTaxRatePct` turns blank into null and refuses the rest, and
   * `validate` in server/amc refuses null on a contract that has a fee.
   */
  taxRatePct: string;
  sacCode: string;
  items: { productId: string | null; productName: string; qty: number; serialNo: string | null }[];
}

function toInput(f: AmcFormInput): AmcContractInput {
  // The parsers throw plain Errors, since lib/ knows nothing of AmcError.
  // Re-thrown as AmcError so `guardWrite` shows the reason on the form
  // instead of "Something went wrong" for what is only a typo.
  try {
    return {
      ...f,
      startDate: parseDay(f.startDate),
      endDate: parseDay(f.endDate),
      taxRatePct: parseTaxRatePct(f.taxRatePct),
      sacCode: parseSacCode(f.sacCode),
    };
  } catch (err) {
    throw new AmcError((err as Error).message);
  }
}

export async function createAmcContractAction(form: AmcFormInput): Promise<ActionState> {
  return guardWrite(async () => {
    const ctx = await requireContext();
    await createAmcContract(ctx.scope, toInput(form), ctx.user.id);
  });
}

export async function updateAmcContractAction(id: string, form: AmcFormInput): Promise<ActionState> {
  return guardWrite(async () => {
    const ctx = await requireContext();
    await updateAmcContract(ctx.scope, id, toInput(form));
  });
}

export async function setAmcStatusAction(
  id: string, next: AmcStatus, reason?: string,
): Promise<ActionState> {
  return guardWrite(async () => {
    const ctx = await requireContext();
    await setAmcStatus(ctx.scope, id, next, { reason });
  });
}

/**
 * Raise the separate invoice that bills an AMC fee.
 *
 * Gated on `invoice.create` rather than on `customers.edit` - this creates a
 * tax document, so it needs the permission that governs creating tax
 * documents. The same 8 managers hold both in this tenant, but conflating them
 * would let a future role that can edit customers start issuing invoices.
 *
 * The invoice lands as a DRAFT, at the GST rate somebody typed on the contract.
 * A contract with no rate is refused rather than billed at a guess. Nothing
 * here makes a tax document final.
 */
export async function raiseAmcInvoiceAction(contractId: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to raise invoices.' };
    }
    const { invoice, taxRatePct } = await raiseAmcInvoice(ctx.scope, contractId, ctx.user.id);
    refresh();
    revalidatePath('/invoices');
    // Name the rate in the message. "Created at 18% GST" can be seen to be
    // wrong at a glance; "check the tax rate" sends somebody off to look.
    return {
      ok: true,
      message: `Draft invoice ${invoice.invoiceNo} created at ${taxRatePct}% GST, as entered on the contract. Check it, then issue it.`,
    };
  } catch (err) {
    if (err instanceof AmcError) return { error: err.message };
    console.error('[amc] raise invoice failed', err);
    return { error: err instanceof Error ? err.message : 'Could not raise the invoice.' };
  }
}

export async function renewAmcContractAction(
  id: string, months: number, amountPaise?: number,
): Promise<ActionState> {
  return guardWrite(async () => {
    const ctx = await requireContext();
    await renewAmcContract(ctx.scope, id, { months, amountPaise, userId: ctx.user.id });
  });
}
