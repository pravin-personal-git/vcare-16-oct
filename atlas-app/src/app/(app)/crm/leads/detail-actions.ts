'use server';

import { visibleAssigneeFilter } from '@/server/complaint-visibility';
import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { getLeadDetail, type LeadDetail } from '@/server/lead-detail';
import { scopeWhere, scopeForWrite } from '@/server/store-scope';

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function loadLeadDetail(leadId: string): Promise<LeadDetail | null> {
  const ctx = await requireContext();
  const detail = await getLeadDetail(ctx.scope, leadId);
  if (!detail) return null;
  // Outside "Leads they see": as if it did not exist (G-08).
  const visible = await visibleAssigneeFilter(ctx, 'leads');
  if (visible && !visible(detail.assignedToUserId ?? null)) return null;
  return detail;
}

/** Every mutation confirms the lead is inside the caller's scope first. */
async function assertOwned(leadId: string) {
  const ctx = await requireContext();
  const lead = await db.lead.findFirst({
    where: { id: leadId, ...scopeWhere(ctx.scope) },
    select: { id: true, storeId: true, firstName: true, leadCode: true },
  });
  if (!lead) throw new Error('Lead not found in your scope.');
  return { ctx, lead };
}

export async function logActivity(
  leadId: string,
  channel: string,
  outcome: string | null,
  note: string | null,
): Promise<ActionResult> {
  try {
    const { ctx, lead } = await assertOwned(leadId);

    await db.leadActivity.create({
      data: { leadId, channel, outcome, note, createdBy: ctx.user.id },
    });

    // A logged conversation is a conversation - keep lastTalkAt honest.
    if (['call', 'whatsapp', 'email', 'meeting'].includes(channel)) {
      await db.lead.update({ where: { id: leadId }, data: { lastTalkAt: new Date() } });
    }

    await db.activityLog.create({
      data: {
        storeId: lead.storeId, userId: ctx.user.id,
        activityType: 'Lead Activity', entityType: 'Lead', entityId: leadId,
        description: `${channel}${outcome ? ` - ${outcome}` : ''} logged on ${lead.leadCode}`,
      },
    }).catch(() => undefined);

    revalidatePath('/crm/leads');
    return { ok: true };
  } catch (err) {
    console.error('[lead] logActivity failed', err);
    return { error: 'Could not log that activity.' };
  }
}

export async function addNote(
  leadId: string, body: string, kind: 'note' | 'comment',
): Promise<ActionResult> {
  try {
    const { ctx } = await assertOwned(leadId);
    const text = body.trim();
    if (!text) return { error: 'Write something first.' };

    await db.leadNote.create({ data: { leadId, body: text, kind, createdBy: ctx.user.id } });
    revalidatePath('/crm/leads');
    return { ok: true };
  } catch (err) {
    console.error('[lead] addNote failed', err);
    return { error: 'Could not save that note.' };
  }
}

export async function deleteNote(noteId: string): Promise<ActionResult> {
  try {
    const ctx = await requireContext();

    // Scope was checked but the permission was not, so anybody who could open
    // the lead could delete its notes - including a read-only role.
    if (!ctx.permissions.has('leads.edit')) {
      return { error: 'Deleting a note needs the leads edit permission.' };
    }

    const note = await db.leadNote.findUnique({
      where: { id: noteId }, include: { lead: { select: { storeId: true } } },
    });
    if (!note) return { error: 'Note not found.' };

    const owned = await db.lead.findFirst({
      where: { id: note.leadId, ...scopeWhere(ctx.scope) }, select: { id: true },
    });
    if (!owned) return { error: 'Not permitted.' };

    /**
     * Tombstoned, not removed (3 Oct 2026). An append-only note should never
     * have been deletable at all; now the row stays and stops being shown, so a
     * note cannot come back from another machine after somebody removed it.
     */
    await db.leadNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date(), deletedBy: ctx.user.id },
    });
    revalidatePath('/crm/leads');
    return { ok: true };
  } catch (err) {
    console.error('[lead] deleteNote failed', err);
    return { error: 'Could not delete that note.' };
  }
}

export async function updateLeadField(
  leadId: string,
  patch: {
    stageId?: string | null;
    dealStageId?: string | null;
    assignedToUserId?: string | null;
    nextActionAt?: string | null;
    potential?: number;
    firstName?: string;
    lastName?: string | null;
    businessName?: string | null;
    mobile?: string;
    email?: string | null;
    requirement?: string | null;
    sharedWithPartner?: string | null;
  },
): Promise<ActionResult> {
  try {
    const { ctx, lead } = await assertOwned(leadId);
    if (!ctx.permissions.has('leads.edit')) {
      return { error: 'You do not have permission to edit leads.' };
    }

    const before = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { stage: { select: { name: true } } },
    });

    const data: Record<string, unknown> = {};
    if (patch.stageId !== undefined) data.stageId = patch.stageId || null;
    if (patch.dealStageId !== undefined) data.dealStageId = patch.dealStageId || null;
    if (patch.assignedToUserId !== undefined) {
      const to = patch.assignedToUserId || null;
      data.assignedToUserId = to;
      // Stamped only when the owner actually changes. Re-saving the same person
      // should not make an old assignment look like today's work.
      if (to !== before.assignedToUserId) data.assignedAt = to ? new Date() : null;
    }
    if (patch.nextActionAt !== undefined) {
      data.nextActionAt = patch.nextActionAt ? new Date(patch.nextActionAt) : null;
    }
    if (patch.potential !== undefined) data.potentialPaise = Math.round(patch.potential * 100);
    if (patch.firstName !== undefined) {
      if (!patch.firstName.trim()) return { error: 'Name is required.' };
      data.firstName = patch.firstName.trim();
    }
    if (patch.lastName !== undefined) data.lastName = patch.lastName?.trim() || null;
    if (patch.businessName !== undefined) data.businessName = patch.businessName?.trim() || null;
    if (patch.mobile !== undefined) {
      if (!patch.mobile.trim()) return { error: 'Mobile number is required.' };
      data.mobile = patch.mobile.trim();
    }
    if (patch.email !== undefined) data.email = patch.email?.trim() || null;
    if (patch.requirement !== undefined) data.requirement = patch.requirement?.trim() || null;
    if (patch.sharedWithPartner !== undefined) {
      data.sharedWithPartner = patch.sharedWithPartner?.trim() || null;
    }

    // Moving to a Won or Lost stage closes the lead.
    if (patch.stageId) {
      const stage = await db.leadStage.findUnique({
        where: { id: patch.stageId }, select: { isWon: true, isLost: true, name: true },
      });
      if (stage) {
        data.isClosed = stage.isWon || stage.isLost;
        if (stage.name !== before.stage?.name) {
          await db.activityLog.create({
            data: {
              storeId: lead.storeId, userId: ctx.user.id,
              activityType: 'Lead Status Change', entityType: 'Lead', entityId: leadId,
              statusFrom: before.stage?.name ?? null, statusTo: stage.name,
              description: `${lead.leadCode}: ${before.stage?.name ?? 'none'} → ${stage.name}`,
            },
          }).catch(() => undefined);
        }
      }
    }

    await db.lead.update({ where: { id: leadId }, data });
    revalidatePath('/crm/leads');
    return { ok: true };
  } catch (err) {
    console.error('[lead] updateLeadField failed', err);
    return { error: 'Could not save that change.' };
  }
}

/**
 * Convert a lead into a customer - A052.
 *
 * Runs in one transaction: create the customer, mark the lead converted and
 * closed, link them. A half-converted lead is worse than an unconverted one.
 */
export async function convertToCustomer(leadId: string): Promise<ActionResult> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('customers.create')) {
      return { error: 'You do not have permission to create customers.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before converting.' };
    }
    const storeId = scopeForWrite(ctx.scope);

    const lead = await db.lead.findFirst({ where: { id: leadId, storeId } });
    if (!lead) return { error: 'Lead not found in your scope.' };
    if (lead.convertedCustomerId) return { error: 'This lead has already been converted.' };

    const existing = await db.party.findFirst({
      where: { storeId, phone: lead.mobile }, select: { partyCode: true },
    });

    const { nextPartyCode, isPartyCodeClash } = await import('@/server/parties');
    const convert = () => db.$transaction(async (tx) => {
      const party = await tx.party.create({
        data: {
          storeId,
          partyCode: await nextPartyCode(storeId, tx),
          isCustomer: true,
          companyName: lead.businessName,
          gstin: lead.gstin,
          title: lead.title,
          firstName: lead.firstName,
          lastName: lead.lastName,
          designation: lead.designation,
          phone: lead.mobile,
          phoneCc: lead.mobileCc,
          altPhone: lead.altMobile,
          email: lead.email,
          website: lead.website,
          addressLine1: lead.addressLine1,
          country: lead.country,
          state: lead.state,
          city: lead.city,
          pincode: lead.pincode,
          latitude: lead.latitude,
          longitude: lead.longitude,
          locationNote: lead.locationNote,
          assignedManagerId: lead.assignedToUserId,
          customerSince: new Date(),
          lastCommunicationAt: lead.lastTalkAt,
        },
      });

      const wonStage = await tx.leadStage.findFirst({ where: { storeId, isWon: true, isGroupHeader: false } })
        ?? await tx.leadStage.findFirst({ where: { storeId, isWon: true } });

      await tx.lead.update({
        where: { id: leadId },
        data: {
          convertedCustomerId: party.id,
          convertedAt: new Date(),
          isClosed: true,
          stageId: wonStage?.id ?? lead.stageId,
        },
      });

      return party;
    });
    // Same code handed to two saves at once: the second retries with the next number.
    let result: Awaited<ReturnType<typeof convert>> | undefined;
    for (let attempt = 0; !result; attempt++) {
      try { result = await convert(); }
      catch (e) { if (attempt >= 3 || !isPartyCodeClash(e)) throw e; }
    }

    await db.activityLog.create({
      data: {
        storeId, userId: ctx.user.id,
        activityType: 'Lead Converted', entityType: 'Lead', entityId: leadId,
        description: `${lead.leadCode} converted to customer ${result.partyCode}`,
      },
    }).catch(() => undefined);

    revalidatePath('/crm/leads');
    revalidatePath('/customers');

    return {
      ok: true,
      message: existing
        ? `Converted to ${result.partyCode}. Note: ${existing.partyCode} already had this mobile.`
        : `Converted to customer ${result.partyCode}.`,
    };
  } catch (err) {
    console.error('[lead] convertToCustomer failed', err);
    return { error: 'Could not convert this lead.' };
  }
}
