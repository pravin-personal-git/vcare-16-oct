import 'server-only';
import { db } from './db';
import { createLead } from './leads';
import { notify, ownersOf } from './notify';

/**
 * Leads from the public landing page (/home, 5 Oct 2026).
 *
 * Which business receives them is N.A.I.R.'s own - the company selling
 * Atlas - never whichever client happens to share the server. Set
 * `LANDING_LEADS_STORE_ID` to N.A.I.R.'s branch; without it the store of the
 * organisation named "N.A.I.R…" is used, and with neither the form says it
 * cannot take requests rather than dropping them on a client.
 */
export class LandingLeadError extends Error {}

async function receivingStore(): Promise<string | null> {
  const fromEnv = process.env.LANDING_LEADS_STORE_ID?.trim();
  if (fromEnv) {
    const s = await db.store.findUnique({ where: { id: fromEnv }, select: { id: true } });
    if (s) return s.id;
  }
  const org = await db.organization.findFirst({
    where: { name: { contains: 'N.A.I.R', mode: 'insensitive' } }, select: { id: true },
  });
  if (!org) return null;
  const store = await db.store.findFirst({ where: { organizationId: org.id, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return store?.id ?? null;
}

export interface LandingLeadInput {
  name: string; phone: string; business: string | null; businessType: string | null;
  city: string | null; teamSize: string | null; interest: string[]; message: string | null; lang: 'en' | 'hi';
}

export async function submitLandingLead(input: LandingLeadInput): Promise<void> {
  const name = input.name.trim().slice(0, 80);
  const digits = input.phone.replace(/\D/g, '').slice(-10);
  if (!name) throw new LandingLeadError('Please write your name.');
  if (!/^[6-9]\d{9}$/.test(digits)) throw new LandingLeadError('Please write a 10-digit mobile number.');

  const storeId = await receivingStore();
  if (!storeId) throw new LandingLeadError('We cannot take requests online right now. Please call or WhatsApp us.');

  const [first, ...rest] = name.split(/\s+/);
  const requirement = [
    input.interest.length ? `Interested in: ${input.interest.join(', ')}` : null,
    input.businessType ? `Business: ${input.businessType}` : null,
    input.teamSize ? `Team size: ${input.teamSize}` : null,
  ].filter(Boolean).join(' · ') || 'Wants a demo of Atlas';

  const r = await createLead({ kind: 'single', storeId, writable: true }, {
    businessName: input.business?.trim().slice(0, 120) || null, gstin: null, title: null,
    firstName: first, lastName: rest.join(' ') || null, designation: null,
    mobile: digits, altMobile: null, email: null, addressLine1: null, addressLine2: null,
    state: null, city: input.city?.trim().slice(0, 60) || null, pincode: null, refCode: null,
    dealStageId: null, stageId: null, sourceId: null, assignedToUserId: null,
    requirement,
    notes: [input.message?.trim().slice(0, 1000), `From the website (${input.lang === 'hi' ? 'Hindi' : 'English'} page).`].filter(Boolean).join('\n'),
    potentialPaise: 0, lastTalkAt: null, nextActionAt: null, tags: ['website'],
    latitude: null, longitude: null, locationNote: null,
  });

  // The same person asking twice still reaches someone.
  if (!r.lead && r.rejected) {
    const existing = await db.lead.findFirst({ where: { storeId, leadCode: r.duplicateOf }, select: { id: true } });
    if (existing) {
      await db.leadNote.create({ data: { leadId: existing.id, kind: 'note', body: `Asked again from the website.\n${requirement}` } });
    }
  }

  await notify({
    storeId, userIds: await ownersOf(storeId), kind: 'system',
    title: `New website enquiry: ${name}${input.business ? ` (${input.business})` : ''}`,
    body: requirement, href: '/crm/leads', entityType: 'lead', entityId: r.lead?.id ?? null,
    dedupeKey: `landing:${digits}:${new Date().toISOString().slice(0, 13)}`,
  }).catch(() => undefined);
}
