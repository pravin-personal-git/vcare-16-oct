'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { createLead, nextRoundRobinUser, type LeadInput } from '@/server/leads';
import { db } from '@/server/db';
import { scopeForWrite } from '@/server/store-scope';
import { missingStandard, readSubmittedValues, writeValues } from '@/server/custom-fields';

export interface LeadFormState {
  error?: string;
  warning?: string;
  ok?: boolean;
  /** The new lead - so a scanned visiting card can be attached to it. */
  id?: string;
}

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};
const paise = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const date = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export async function addLead(
  _prev: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('leads.create')) {
      return { error: 'You do not have permission to add leads.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before adding a lead.' };
    }

    const firstName = String(formData.get('firstName') ?? '').trim();
    const mobile = String(formData.get('mobile') ?? '').trim();

    if (!firstName) return { error: 'First name is required.' };
    if (!/^\d{10}$/.test(mobile)) return { error: 'Mobile must be a 10-digit number.' };

    const gstin = str(formData.get('gstin'));
    if (gstin && gstin.length !== 15) return { error: 'GSTIN must be exactly 15 characters.' };

    // Settings > Custom Fields: mandatory built-ins and the owner's extra fields.
    const stdMissing = await missingStandard(ctx.scope, 'lead', formData);
    if (stdMissing) return { error: stdMissing };
    const custom = await readSubmittedValues(ctx.scope, 'lead', formData);
    if (custom.error) return { error: custom.error };

    // "Assign later" is a real choice; round robin only when asked for.
    let assignedToUserId = str(formData.get('assignedToUserId'));
    if (assignedToUserId === '__round_robin__') {
      assignedToUserId = await nextRoundRobinUser(scopeForWrite(ctx.scope));
    }

    const input: LeadInput = {
      businessName: str(formData.get('businessName')),
      gstin,
      title: str(formData.get('title')),
      firstName,
      lastName: str(formData.get('lastName')),
      designation: str(formData.get('designation')),
      mobile,
      altMobile: str(formData.get('altMobile')),
      email: str(formData.get('email')),
      addressLine1: str(formData.get('addressLine1')),
      addressLine2: str(formData.get('addressLine2')),
      state: str(formData.get('state')),
      city: str(formData.get('city')),
      pincode: str(formData.get('pincode')),
      refCode: str(formData.get('refCode')),
      dealStageId: str(formData.get('dealStageId')),
      stageId: str(formData.get('stageId')),
      sourceId: str(formData.get('sourceId')),
      assignedToUserId,
      requirement: str(formData.get('requirement')),
      notes: str(formData.get('notes')),
      potentialPaise: paise(formData.get('potential')),
      lastTalkAt: date(formData.get('lastTalk')),
      nextActionAt: date(formData.get('nextAction')),
      tags: String(formData.get('tags') ?? '')
        .split(',').map((t) => t.trim()).filter(Boolean),
      latitude: num(formData.get('latitude')),
      longitude: num(formData.get('longitude')),
      locationNote: str(formData.get('locationNote')),
    };

    const { lead, duplicateOf, rejected } = await createLead(ctx.scope, input);

    if (rejected) {
      return { error: `A lead with this mobile already exists (${duplicateOf}). Store policy rejects duplicates.` };
    }
    if (!lead) return { error: 'Could not save the lead.' };
    await writeValues('lead', lead.id, custom.values);

    await db.activityLog.create({
      data: {
        storeId: lead.storeId,
        userId: ctx.user.id,
        activityType: 'Create',
        entityType: 'Lead',
        entityId: lead.id,
        description: `Lead '${lead.firstName}' created (${lead.leadCode})`,
      },
    }).catch((e) => console.error('[leads] audit write failed (non-fatal)', e));

    revalidatePath('/crm/leads');
    return {
      ok: true,
      id: lead.id,
      warning: duplicateOf
        ? `Saved. Note: this mobile already exists on ${duplicateOf}.`
        : undefined,
    };
  } catch (err) {
    console.error('[leads] create failed', err);
    return { error: 'Could not save the lead. Please try again.' };
  }
}
