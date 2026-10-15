'use server';

import { revalidatePath } from 'next/cache';
import { visitSubject } from '@/lib/visit-reasons';
import { requireContext } from '@/server/context';
import { listSites } from '@/server/sites';
import {
  listComplaints, getComplaintDetail, createComplaint, assignTechnician, setResolutionType,
  updateComplaintStatus, addComplaintNote, listServiceVisits, scheduleVisit, scheduleInstallationVisit, completeVisit, rescheduleVisit, cancelVisit,
  listRepairChallans, listTechnicians, listCustomerPurchases,
  listFieldConfigs, saveFieldConfig, removeFieldConfig, fieldCheckIn, ComplaintError, updateRepairChallan,
  type CreateComplaintInput, type FieldConfigInput, type FieldCheckInInput, type UpdateChallanInput,
} from '@/server/complaints';
import { resolveCoverageFor } from '@/server/amc';
import { friendlyError } from '@/lib/friendly-error';
import { cancelJobIssue, correctJobIssue, issueJobChallan, serialChoices, logFaultyPart, raiseJobChallan, receiveFaultyPart, receiveReturnedParts, requestPartsReturn, returnUnusedParts } from '@/server/job-challans';
import { customerLinkToken, sendEstimate, type EstimateLine } from '@/server/job-customer';
import { billJob, waiveJobBilling } from '@/server/job-billing';
import { addComplaintItem, cancelComplaintItem, listCustomerEquipment, pickUpItems, requestWarrantyVoid, type ComplaintItemInput } from '@/server/complaint-items';
import { createInstallationJob, installationSetup, type InstallationSetup } from '@/server/installation-jobs';
import { istWallClock } from '@/lib/date-ranges';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

function refresh() {
  revalidatePath('/services/complaints');
  revalidatePath('/services/visits');
  revalidatePath('/services/complaints', 'layout');
  revalidatePath('/services/repairs', 'layout');
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) {
      return { error: 'You do not have permission to manage complaints.' };
    }
    await run();
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof ComplaintError) return { error: err.message };
    console.error('[services] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function loadComplaintsAction(status?: string) {
  const ctx = await requireContext();
  return listComplaints(ctx.scope, { status });
}

/**
 * The complaint, plus WHO PAYS for it.
 *
 * Coverage rides along on the same server action rather than in a second call
 * from the browser. It cannot run concurrently with the detail read - it needs
 * the customer and product ids that read returns - but keeping it server-side
 * makes it one network round trip instead of two. The tracker is already the
 * slowest screen in the app (INP measured at 3.1s - see B1 in
 * VCARE-CLIENT-FINDINGS), so a second browser fetch to open a complaint would
 * make a known problem measurably worse.
 *
 * Coverage is the whole point of Phase 4 being wired in here: knowing a
 * customer holds a contract is only useful at the moment somebody is deciding
 * whether to dispatch, and that decision is made on this screen.
 *
 * Resolved against the complaint's OWN date, not today. A complaint raised
 * inside a contract period stays covered even if it is looked at after the
 * contract ended - otherwise an old job silently changes answer and the
 * invoice raised against it stops matching.
 */
export async function loadComplaintDetailAction(id: string) {
  const ctx = await requireContext();
  const detail = await getComplaintDetail(ctx.scope, id);
  if (!detail) return null;

  const coverage = await resolveCoverageFor(ctx.scope, {
    customerId: detail.customerId,
    productId: detail.productId,
    onDate: detail.createdAt,
  });

  return { ...detail, coverage };
}

export async function loadTechniciansAction() {
  const ctx = await requireContext();
  return listTechnicians(ctx.scope);
}

export async function loadCustomerPurchasesAction(customerId: string) {
  const ctx = await requireContext();
  return listCustomerPurchases(ctx.scope, customerId);
}

/**
 * What this customer has from us, serial by serial, with each one's cover -
 * the complaint form's checklist (10 Oct 2026, repair flow stage 2).
 */
export async function loadCustomerEquipmentAction(customerId: string) {
  const ctx = await requireContext();
  const rows = await listCustomerEquipment(ctx.scope, customerId);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return rows.map((r) => ({ ...r, installedOn: iso(r.installedOn), warrantyUntil: iso(r.warrantyUntil), amcUntil: iso(r.amcUntil) }));
}

export async function addComplaintItemAction(complaintId: string, input: ComplaintItemInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await addComplaintItem(ctx.scope, complaintId, input, ctx.user.id);
  });
}

export async function cancelComplaintItemAction(itemId: string, reason: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await cancelComplaintItem(ctx.scope, itemId, reason, ctx.user.id);
  });
}

/**
 * Take the customer's items away for repair on one pickup receipt (stage 3).
 * A unit that would not move or a case that would not open is reported back,
 * not fatal - the receipt stands, because the items did leave the site.
 */
export async function pickUpItemsAction(complaintId: string, itemIds: string[], handedOverBy: string | null, note: string | null): Promise<ActionState & { pickupNo?: string; warnings?: string[] }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to manage complaints.' };
    const r = await pickUpItems(ctx.scope, complaintId, { itemIds, handedOverBy, note }, ctx.user.id);
    refresh();
    return { ok: true, pickupNo: r.pickupNo, warnings: r.warnings };
  } catch (err) {
    if (err instanceof ComplaintError) return { error: err.message };
    console.error('[services] pickup failed', err);
    return { error: friendlyError(err) };
  }
}

/** Hand items back to the customer on a GDN on this complaint (repair flow stage 6). */
export async function handBackItemsAction(complaintId: string, itemIds: string[], fromStock: Record<string, string>, receivedBy: string | null, note: string | null): Promise<ActionState & { gdnNo?: string; issueId?: string; warnings?: string[] }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to manage complaints.' };
    const { handBackItems } = await import('@/server/item-handback');
    const r = await handBackItems(ctx.scope, complaintId, { itemIds, fromStock, receivedBy, note }, ctx.user.id);
    refresh();
    return { ok: true, gdnNo: r.gdnNo, issueId: r.issueId, warnings: r.warnings };
  } catch (err) {
    if (err instanceof ComplaintError) return { error: err.message };
    console.error('[services] hand back failed', err);
    return { error: friendlyError(err) };
  }
}

/** Ask a manager to void one item's warranty; they decide in My Desk. */
export async function requestWarrantyVoidAction(itemId: string, reason: string, photoId: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await requestWarrantyVoid(ctx.scope, itemId, { reason, photoId }, ctx.user.id);
  });
}

/** The customer's named sites (Phase 5), active ones only, for the complaint form. */
export async function loadCustomerSitesAction(customerId: string) {
  const ctx = await requireContext();
  const sites = await listSites(ctx.scope, customerId);
  return sites.filter((s) => s.isActive).map((s) => ({
    id: s.id, name: s.name, address: s.address, contactName: s.contactName, contactPhone: s.contactPhone,
    latitude: s.latitude, longitude: s.longitude,
  }));
}

export async function loadFieldConfigsAction() {
  const ctx = await requireContext();
  return listFieldConfigs(ctx.scope);
}

export async function saveFieldConfigAction(id: string | null, input: FieldConfigInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await saveFieldConfig(ctx.scope, id, input);
  });
}

export async function removeFieldConfigAction(id: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await removeFieldConfig(ctx.scope, id);
  });
}

export async function createComplaintAction(input: CreateComplaintInput): Promise<ActionState & { id?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) {
      return { error: 'You do not have permission to raise complaints.' };
    }
    const id = await createComplaint(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, id };
  } catch (err) {
    if (err instanceof ComplaintError) return { error: err.message };
    console.error('[services] createComplaint failed', err);
    return { error: 'Could not raise that complaint. Please try again.' };
  }
}

export async function assignTechnicianAction(complaintId: string, technicianId: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await assignTechnician(ctx.scope, complaintId, technicianId, ctx.user.id);
  });
}

export async function setResolutionTypeAction(complaintId: string, resolutionType: 'field_visit' | 'direct_replacement'): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await setResolutionType(ctx.scope, complaintId, resolutionType, ctx.user.id);
  });
}

export async function updateComplaintStatusAction(complaintId: string, status: string, reason?: string | null): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await updateComplaintStatus(ctx.scope, complaintId, status, ctx.user.id, 'office', reason, ctx.permissions);
  });
}

export async function rescheduleVisitAction(visitId: string, newAt: string, reason: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await rescheduleVisit(ctx.scope, visitId, istWallClock(newAt), reason, ctx.user.id);
  });
}

export async function cancelVisitAction(visitId: string, reason: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await cancelVisit(ctx.scope, visitId, reason, ctx.user.id);
  });
}

/** `share`: the customer sees it on their link and portal; otherwise staff only. */
export async function addComplaintNoteAction(complaintId: string, body: string, share = false): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await addComplaintNote(ctx.scope, complaintId, body, ctx.user.id, share === true);
  });
}

export async function loadServiceVisitsAction(status?: string) {
  const ctx = await requireContext();
  return listServiceVisits(ctx.scope, { status });
}

/**
 * Book a visit. One action for both kinds (7 Oct 2026).
 *
 * `reason` decides which record the visit hangs off - the registry in
 * `lib/visit-reasons` answers that, and the server re-checks it rather than
 * trusting what the form sent. `subjectId` is a complaint id or an
 * installation challan id accordingly.
 */
export async function scheduleVisitAction(
  subjectId: string, technicianId: string, purpose: string, scheduledAt: string, reason = 'existing_complaint',
): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    if (visitSubject(reason) === 'installation') {
      await scheduleInstallationVisit(ctx.scope, subjectId, technicianId, reason, istWallClock(scheduledAt), ctx.user.id);
      return;
    }
    await scheduleVisit(ctx.scope, subjectId, technicianId, purpose, istWallClock(scheduledAt), ctx.user.id, 'office', reason);
  });
}

export async function completeVisitAction(visitId: string, outcomeNote: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await completeVisit(ctx.scope, visitId, outcomeNote, ctx.user.id);
  });
}

export async function fieldCheckInAction(
  input: FieldCheckInInput,
): Promise<ActionState & { withinRange?: boolean; distanceMeters?: number; radiusMeters?: number }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) {
      return { error: 'You do not have permission to check in on a visit.' };
    }
    const result = await fieldCheckIn(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof ComplaintError) return { error: err.message };
    console.error('[services] fieldCheckIn failed', err);
    return { error: 'Could not record the check-in. Please try again.' };
  }
}

export async function loadRepairChallansAction() {
  const ctx = await requireContext();
  return listRepairChallans(ctx.scope);
}

/** Correct a saved repair challan - fields, and stock if it moved any (SVC-3). */
export async function updateRepairChallanAction(input: Omit<UpdateChallanInput, 'dispatchedAt'> & { dispatchedAt: string }): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    const at = new Date(input.dispatchedAt);
    if (Number.isNaN(at.getTime())) throw new ComplaintError('Choose a valid date.');
    await updateRepairChallan(ctx.scope, { ...input, dispatchedAt: at }, ctx.user.id);
  });
}


// ------------------------------------------------ job challans & GDN (workflow slice 4)

export async function raiseJobChallanAction(complaintId: string, input: { type: string; lines: { productId: string; qty: number }[]; note: string | null }): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await raiseJobChallan(ctx.scope, complaintId, input, ctx.user.id, 'office');
  });
}

/** The store issues an approved challan as a GDN - needs stock rights, like any dispatch. */
export async function issueJobChallanAction(challanId: string, serials: Record<string, string[]> = {}): Promise<ActionState & { gdnNo?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Issuing parts needs stock rights (Roles > Stock: Edit).' };
    const r = await issueJobChallan(ctx.scope, challanId, ctx.user.id, serials);
    refresh();
    return { ok: true, gdnNo: r.gdnNo };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/**
 * Unused parts coming back. The store (Stock: Edit) takes them straight into
 * stock; anyone else only says they are coming back, and the store receives
 * them from Parts counter (28 Sep 2026).
 */
export async function returnUnusedPartsAction(lineId: string, qty: number, unitIds?: string[], asRequest = false): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    // Serial items always come back as a request: the store ticks the serials when receiving.
    if (ctx.permissions.has('stock.adjust') && !asRequest) await returnUnusedParts(ctx.scope, lineId, qty, ctx.user.id, unitIds);
    else await requestPartsReturn(ctx.scope, lineId, qty, ctx.user.id);
  });
}

/** The store receives parts a technician said were coming back. */
export async function receiveReturnedPartsAction(lineId: string, unitIds?: string[]): Promise<ActionState & { qty?: number }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Receiving parts needs stock rights (Roles > Stock: Edit).' };
    const qty = await receiveReturnedParts(ctx.scope, lineId, ctx.user.id, unitIds);
    refresh();
    return { ok: true, qty };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

export async function logFaultyPartAction(complaintId: string, input: { productId: string | null; description: string; serialNo: string | null }): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await logFaultyPart(ctx.scope, complaintId, input, ctx.user.id);
  });
}

export async function receiveFaultyPartAction(id: string, serialNo?: string | null): Promise<ActionState & { caseNo?: string | null }> {
  try {
    const ctx = await requireContext();
    // The store receives it (28 Sep 2026: no longer the technician's own word).
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Receiving at the store needs stock rights (Roles > Stock: Edit).' };
    const r = await receiveFaultyPart(ctx.scope, id, ctx.user.id, serialNo ?? null);
    refresh();
    return { ok: true, caseNo: r.caseNo };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

// ------------------------------------------------ customer side (workflow slice 5)

/** The customer's no-login link for this job, and the customer's phone for WhatsApp. */
export async function customerLinkAction(complaintId: string): Promise<ActionState & { url?: string; phone?: string | null }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to manage complaints.' };
    const token = await customerLinkToken(ctx.scope, complaintId);
    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const c = await getComplaintDetail(ctx.scope, complaintId);
    return { ok: true, url: `${proto}://${host}/j/${token}`, phone: c?.customerPhone ?? null };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

export async function sendEstimateAction(complaintId: string, lines: EstimateLine[], note: string | null): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await sendEstimate(ctx.scope, complaintId, lines, note, ctx.user.id);
  });
}

// ------------------------------------------------ installation jobs (workflow slice 9)

export async function loadInstallationSetupAction(salesOrderId: string): Promise<ActionState & { setup?: InstallationSetup }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'Raising a job needs complaint rights (Roles > Complaints: Edit).' };
    return { ok: true, setup: await installationSetup(ctx.scope, salesOrderId) };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

export async function createInstallationJobAction(
  salesOrderId: string,
  input: { siteId: string | null; location: { lat: number; lng: number; source: 'gps' | 'maps_link' } | null; siteNote: string | null; priority: string; note: string | null; lineIds?: string[] },
): Promise<ActionState & { id?: string; challanNo?: string; href?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'Raising a job needs complaint rights (Roles > Complaints: Edit).' };
    const r = await createInstallationJob(ctx.scope, salesOrderId, input, ctx.user.id);
    revalidatePath('/services/installations');
    refresh();
    return { ok: true, ...r };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/** The store corrects a GDN: fewer parts handed over than issued (28 Sep 2026). */
export async function correctJobIssueAction(challanId: string, lines: { lineId: string; qty: number; unitIds?: string[] }[], reason: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Correcting a GDN needs stock rights (Roles > Stock: Edit).' };
    await correctJobIssue(ctx.scope, challanId, lines, reason, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/** The store cancels a GDN made by mistake - parts back in stock, challan back in the queue. */
export async function cancelJobIssueAction(challanId: string, reason: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Cancelling a GDN needs stock rights (Roles > Stock: Edit).' };
    await cancelJobIssue(ctx.scope, challanId, reason, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/** Bill a field job - a draft invoice at the parts actually used (28 Sep 2026). */
export async function billJobAction(complaintId: string): Promise<ActionState & { invoiceId?: string; invoiceNo?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) return { error: 'Billing needs invoice rights (Roles > Invoices & receipts: Edit).' };
    const r = await billJob(ctx.scope, complaintId, ctx.user.id);
    refresh();
    return { ok: true, invoiceId: r.id, invoiceNo: r.invoiceNo };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/** Don't bill a job that had charges - goodwill, our mistake - with the reason kept (stage 7). */
export async function waiveBillingAction(complaintId: string, reason: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) return { error: 'Deciding not to bill needs invoice rights (Roles > Invoices & receipts: Edit).' };
    await waiveJobBilling(ctx.scope, complaintId, reason, ctx.user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/** In-stock serial units for a challan's serial lines - the store picks which go on the GDN. */
export async function serialChoicesAction(challanId: string): Promise<ActionState & { lines?: { lineId: string; productName: string; qty: number; units: { id: string; serialNo: string }[] }[] }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) return { error: 'Issuing parts needs stock rights (Roles > Stock: Edit).' };
    return { ok: true, lines: await serialChoices(ctx.scope, challanId) };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ComplaintError) };
  }
}

/**
 * Remove a photo or file from a job (3 Oct 2026).
 *
 * `complaints.edit`, the same right as attaching one - the technician who took the
 * photo is the person already allowed to update the job, and a separate permission
 * would mean every client reconfiguring roles before a wrong photo could be taken
 * down.
 *
 * The attachment ROW is tombstoned and the stored FILE is deleted. A photo
 * somebody removed from a customer-visible job page is usually removed because it
 * should not be there, and keeping the bytes to make a hypothetical restore
 * tidier would defeat the point of removing it.
 */
export async function removeJobPhoto(
  complaintId: string, fileId: string,
): Promise<{ error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) {
      return { error: 'You do not have permission to change this job.' };
    }
    const { removeAttachment } = await import('@/server/attachments');
    await removeAttachment(ctx.scope, fileId, ctx.user.id);
    revalidatePath(`/services/complaints/${complaintId}`);
    return {};
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
