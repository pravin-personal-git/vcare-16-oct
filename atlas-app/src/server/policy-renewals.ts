import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { businessSettings } from './notify';
import { whatsappNumberProblem } from '@/lib/revenue';
import {
  DEFAULT_RENEWAL_TEMPLATE, fillTemplate, isFrequency, nextDue, offsetsOf, renewalState,
  type Frequency, type RenewalState,
} from '@/lib/renewal-cycle';

/**
 * HRM - Insurance & Policy: renewals that must not be missed.
 *
 * Reworked 27 Sep 2026 (NOTIFICATIONS-APPROVALS-SPEC.md §1): a policy is the
 * company's own or a client's, has a billing cycle, and "Mark paid" writes
 * its history and moves it to the next due date. `expiryDate` is that next
 * due date. Reminders (15 / 7 / on the day by default) come from
 * server/reminders.ts.
 */
export class PolicyRenewalError extends Error {}

export interface PolicyRenewalRow {
  id: string;
  title: string;
  policyType: string;
  provider: string | null;
  policyNumber: string | null;
  /** The next due date. */
  expiryDate: Date;
  reminderDays: number;
  notes: string | null;
  isActive: boolean;
  ownerKind: 'company' | 'client';
  partyId: string | null;
  partyName: string | null;
  partyPhone: string | null;
  /** The policy's own WhatsApp number, if one was saved on it. */
  contactPhone: string | null;
  /** The number the WhatsApp button will actually use: the policy's own, else the client's. */
  whatsappPhone: string | null;
  frequency: Frequency;
  expectedAmountPaise: number | null;
  /** This policy's own reminder days, empty = the business default. */
  ownOffsets: number[];
  /** The days actually used. */
  offsets: number[];
  responsibleUserId: string | null;
  responsibleName: string | null;
  remindClient: boolean;
  status: string;
  closedReason: string | null;
  state: RenewalState;
  daysToExpiry: number;
  isDue: boolean;
  isOverdue: boolean;
  lastPaid: { dueDate: Date; amountPaise: number; paidAt: Date } | null;
  paidThisYearPaise: number;
}

export async function listPolicyRenewals(scope: StoreScope): Promise<PolicyRenewalRow[]> {
  const rows = await db.policyRenewal.findMany({
    where: scopeWhere(scope),
    orderBy: { expiryDate: 'asc' },
    include: {
      party: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
      payments: { orderBy: { dueDate: 'desc' }, select: { dueDate: true, amountPaise: true, paidAt: true } },
    },
  });
  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const defaults = new Map<string, number[]>();
  for (const id of storeIds) defaults.set(id, (await businessSettings(id)).renewalOffsets);
  const people = new Map((await db.user.findMany({
    where: { id: { in: rows.map((r) => r.responsibleUserId).filter((x): x is string => !!x) } },
    select: { id: true, fullName: true },
  })).map((u) => [u.id, u.fullName]));
  const yearAgo = Date.now() - 365 * 86_400_000;

  return rows.map((r) => {
    const offsets = offsetsOf(r.reminderOffsets, defaults.get(r.storeId));
    const status = r.isActive ? r.status : 'closed';
    const { state, daysLeft } = renewalState({ expiryDate: r.expiryDate, status, reminderOffsets: offsets });
    const partyName = r.party ? (r.party.companyName || [r.party.firstName, r.party.lastName].filter(Boolean).join(' ')) : null;
    return {
      id: r.id, title: r.title, policyType: r.policyType, provider: r.provider, policyNumber: r.policyNumber,
      expiryDate: r.expiryDate, reminderDays: r.reminderDays, notes: r.notes, isActive: r.isActive && r.status === 'active',
      ownerKind: r.ownerKind === 'client' ? 'client' : 'company', partyId: r.partyId, partyName, partyPhone: r.party?.phone ?? null,
      contactPhone: r.contactPhone, whatsappPhone: policyWhatsappPhone(r.contactPhone, r.party?.phone ?? null),
      frequency: isFrequency(r.frequency) ? r.frequency : 'yearly', expectedAmountPaise: r.expectedAmountPaise,
      ownOffsets: r.reminderOffsets, offsets, responsibleUserId: r.responsibleUserId,
      responsibleName: r.responsibleUserId ? people.get(r.responsibleUserId) ?? null : null,
      remindClient: r.remindClient, status, closedReason: r.closedReason, state,
      daysToExpiry: daysLeft, isDue: state === 'due_soon' || state === 'due_today', isOverdue: state === 'overdue',
      lastPaid: r.payments[0] ?? null,
      paidThisYearPaise: r.payments.filter((p) => p.paidAt.getTime() >= yearAgo).reduce((n, p) => n + p.amountPaise, 0),
    };
  });
}

export async function policyHistory(scope: StoreScope, id: string) {
  const p = await db.policyRenewal.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true } });
  if (!p) return [];
  const rows = await db.policyRenewalPayment.findMany({ where: { policyId: id }, orderBy: { dueDate: 'desc' } });
  const who = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.paidBy).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id, dueDate: r.dueDate.toISOString(), paidAt: r.paidAt.toISOString(), amountPaise: r.amountPaise,
    paidBy: r.paidBy ? who.get(r.paidBy) ?? null : null, note: r.note,
  }));
}

export interface PolicyRenewalInput {
  title: string;
  policyType: string;
  provider: string | null;
  policyNumber: string | null;
  /** The next due date. */
  expiryDate: Date;
  notes: string | null;
  ownerKind: 'company' | 'client';
  partyId: string | null;
  frequency: string;
  expectedAmountPaise: number | null;
  reminderOffsets: number[];
  responsibleUserId: string | null;
  remindClient: boolean;
  /** WhatsApp number for the reminder. Empty on a client policy = use the client's own. */
  contactPhone: string | null;
}

async function validate(storeId: string, input: PolicyRenewalInput) {
  if (!input.title.trim()) throw new PolicyRenewalError('Title is required.');
  if (!input.expiryDate || Number.isNaN(input.expiryDate.getTime())) throw new PolicyRenewalError('The due date is required.');
  if (!isFrequency(input.frequency)) throw new PolicyRenewalError('Choose how often it is paid.');
  if (input.ownerKind === 'client') {
    if (!input.partyId) throw new PolicyRenewalError('Choose the client this policy belongs to.');
    const p = await db.party.findFirst({ where: { id: input.partyId, storeId }, select: { id: true } });
    if (!p) throw new PolicyRenewalError('That client is not in this branch.');
  }
  if (input.expectedAmountPaise !== null && input.expectedAmountPaise < 0) throw new PolicyRenewalError('The amount cannot be negative.');
  if (input.reminderOffsets.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) throw new PolicyRenewalError('Reminder days must be between 0 and 365.');
  const phoneProblem = whatsappNumberProblem(input.contactPhone ?? '');
  if (phoneProblem) throw new PolicyRenewalError(phoneProblem);
}

const fields = (input: PolicyRenewalInput) => ({
  title: input.title.trim(),
  policyType: input.policyType,
  provider: input.provider?.trim() || null,
  policyNumber: input.policyNumber?.trim() || null,
  expiryDate: input.expiryDate,
  notes: input.notes?.trim() || null,
  ownerKind: input.ownerKind,
  partyId: input.ownerKind === 'client' ? input.partyId : null,
  frequency: input.frequency,
  expectedAmountPaise: input.expectedAmountPaise,
  reminderOffsets: [...new Set(input.reminderOffsets)].sort((a, b) => b - a),
  // Kept filled for anything still reading the old single number.
  reminderDays: input.reminderOffsets.length ? Math.max(...input.reminderOffsets) : 15,
  responsibleUserId: input.responsibleUserId,
  remindClient: input.ownerKind === 'client' && input.remindClient,
  contactPhone: input.contactPhone?.trim() || null,
});

/**
 * The number a renewal message goes to: the policy's own first, then the
 * client's. One function, so the button, the list and any later automatic
 * reminder cannot pick different numbers for the same policy.
 */
export function policyWhatsappPhone(contactPhone: string | null, partyPhone: string | null): string | null {
  return contactPhone?.trim() || partyPhone?.trim() || null;
}

export async function createPolicyRenewal(scope: StoreScope, input: PolicyRenewalInput) {
  const storeId = scopeForWrite(scope);
  await validate(storeId, input);
  return db.policyRenewal.create({ data: { storeId, ...fields(input) } });
}

export async function updatePolicyRenewal(scope: StoreScope, id: string, input: PolicyRenewalInput) {
  const storeId = scopeForWrite(scope);
  await validate(storeId, input);
  const found = await db.policyRenewal.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyRenewalError('That record is not in your scope.');
  return db.policyRenewal.update({ where: { id }, data: fields(input) });
}

/**
 * Mark the current due paid / renewed: history row, then on to the next due
 * date by one cycle - counted from the due date, so paying late does not
 * drift the schedule. A one-time policy closes.
 */
export async function markPolicyPaid(
  scope: StoreScope, id: string, input: { amountPaise: number; note: string | null }, userId: string,
) {
  const storeId = scopeForWrite(scope);
  const p = await db.policyRenewal.findFirst({ where: { id, storeId } });
  if (!p) throw new PolicyRenewalError('That record is not in your scope.');
  if (p.status !== 'active' || !p.isActive) throw new PolicyRenewalError('This policy is closed.');
  if (!Number.isFinite(input.amountPaise) || input.amountPaise < 0) throw new PolicyRenewalError('Enter the amount paid.');
  const frequency: Frequency = isFrequency(p.frequency) ? p.frequency : 'yearly';
  const next = nextDue(p.expiryDate, frequency);
  await db.$transaction([
    db.policyRenewalPayment.create({
      data: { storeId, policyId: id, dueDate: p.expiryDate, amountPaise: Math.round(input.amountPaise), paidBy: userId, note: input.note?.trim() || null },
    }),
    db.policyRenewal.update({
      where: { id },
      data: next ? { expiryDate: next } : { status: 'closed', closedReason: 'One-time - paid' },
    }),
  ]);
  return { nextDueDate: next };
}

/** Old single-date renew - kept for the existing action; now also records history (amount 0). */
export async function renewPolicy(scope: StoreScope, id: string, newExpiryDate: Date, userId?: string) {
  const storeId = scopeForWrite(scope);
  const found = await db.policyRenewal.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyRenewalError('That record is not in your scope.');
  await db.$transaction([
    db.policyRenewalPayment.create({ data: { storeId, policyId: id, dueDate: found.expiryDate, amountPaise: 0, paidBy: userId ?? null, note: 'Renewed (new date set by hand)' } }),
    db.policyRenewal.update({ where: { id }, data: { expiryDate: newExpiryDate } }),
  ]);
}

/** Not renewing / closed - with a reason; the history stays. Reopen by passing 'active'. */
export async function setPolicyStatus(scope: StoreScope, id: string, status: 'active' | 'not_renewing' | 'closed', reason: string | null) {
  const storeId = scopeForWrite(scope);
  const found = await db.policyRenewal.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyRenewalError('That record is not in your scope.');
  if (status !== 'active' && !reason?.trim()) throw new PolicyRenewalError('Say why.');
  return db.policyRenewal.update({
    where: { id },
    data: { status, isActive: status === 'active', closedReason: status === 'active' ? null : reason!.trim() },
  });
}

export async function setPolicyRenewalActive(scope: StoreScope, id: string, isActive: boolean) {
  return setPolicyStatus(scope, id, isActive ? 'active' : 'closed', isActive ? null : 'Switched off');
}

/** The WhatsApp text and number for a policy - client policies go to the client. */
export async function renewalMessage(scope: StoreScope, id: string, businessName: string) {
  const p = await db.policyRenewal.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { party: { select: { firstName: true, lastName: true, companyName: true, phone: true } } },
  });
  if (!p) return null;
  const tpl = (await businessSettings(p.storeId)).whatsappTemplate ?? DEFAULT_RENEWAL_TEMPLATE;
  const client = p.party ? (p.party.firstName ? [p.party.firstName, p.party.lastName].filter(Boolean).join(' ') : p.party.companyName) : null;
  const text = fillTemplate(tpl, {
    client, policy: p.title, number: p.policyNumber, dueDate: p.expiryDate, amountPaise: p.expectedAmountPaise,
    business: businessName, daysLeft: renewalState({ expiryDate: p.expiryDate, status: p.status, reminderOffsets: p.reminderOffsets }).daysLeft,
  });
  return { text, phone: policyWhatsappPhone(p.contactPhone, p.party?.phone ?? null) };
}
