import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { V1Error } from './auth/v1-staff';

/**
 * Lead follow-up writes for Vcare - the same three things a salesperson
 * does on the website's lead drawer (log a call/visit, add a note, set the
 * next follow-up), scoped the same way: the lead must be in the caller's
 * scope before anything is written.
 */

export const LEAD_CHANNELS = ['call', 'whatsapp', 'meeting', 'visit', 'email'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

async function ownedLead(scope: StoreScope, leadId: string) {
  const lead = await db.lead.findFirst({
    where: { id: leadId, ...scopeWhere(scope) },
    select: { id: true, storeId: true, leadCode: true },
  });
  if (!lead) throw new V1Error('That lead is not in your branch.', 404);
  return lead;
}

export async function logLeadActivity(
  scope: StoreScope, userId: string, leadId: string,
  input: { channel: LeadChannel; outcome: string | null; note: string | null },
): Promise<void> {
  const lead = await ownedLead(scope, leadId);
  await db.leadActivity.create({
    data: { leadId, channel: input.channel, outcome: input.outcome, note: input.note, createdBy: userId },
  });
  if (input.channel !== 'email') {
    await db.lead.update({ where: { id: leadId }, data: { lastTalkAt: new Date() } });
  }
  await db.activityLog.create({
    data: {
      storeId: lead.storeId, userId,
      activityType: 'Lead Activity', entityType: 'Lead', entityId: leadId,
      description: `${input.channel}${input.outcome ? ` - ${input.outcome}` : ''} logged on ${lead.leadCode} (Vcare)`,
    },
  }).catch(() => undefined);
}

export async function addLeadNote(scope: StoreScope, userId: string, leadId: string, body: string): Promise<void> {
  await ownedLead(scope, leadId);
  const text = body.trim();
  if (!text) throw new V1Error('Write something first.');
  await db.leadNote.create({ data: { leadId, body: text.slice(0, 4000), kind: 'note', createdBy: userId } });
}

export async function setLeadNextAction(scope: StoreScope, leadId: string, at: Date | null): Promise<void> {
  await ownedLead(scope, leadId);
  if (at && Number.isNaN(at.getTime())) throw new V1Error('Choose a valid date.');
  await db.lead.update({ where: { id: leadId }, data: { nextActionAt: at } });
}
