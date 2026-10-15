'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createPolicyRenewal, markPolicyPaid, policyHistory, PolicyRenewalError, renewalMessage, setPolicyStatus,
  updatePolicyRenewal, type PolicyRenewalInput,
} from '@/server/policy-renewals';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(run: () => Promise<unknown>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('renewals.edit')) {
      return { error: 'You do not have permission to change this.' };
    }
    const out = await run();
    revalidatePath('/hrm/renewal');
    return { ok: true, message: typeof out === 'string' ? out : undefined };
  } catch (err) {
    if (err instanceof PolicyRenewalError) return { error: err.message };
    console.error('[policy-renewals] action failed', err);
    return { error: friendlyError(err) };
  }
}

export type PolicyForm = Omit<PolicyRenewalInput, 'expiryDate'> & { expiryDate: string };

export async function savePolicyRenewal(id: string | null, input: PolicyForm) {
  return guard(async () => {
    const ctx = await requireContext();
    const data: PolicyRenewalInput = { ...input, expiryDate: new Date(`${input.expiryDate}T10:00:00+05:30`) };
    if (id) await updatePolicyRenewal(ctx.scope, id, data);
    else await createPolicyRenewal(ctx.scope, data);
  });
}

/** Mark the current due paid / renewed - history, then the next due date. */
export async function markPaid(id: string, amountRupees: number, note: string | null) {
  return guard(async () => {
    const ctx = await requireContext();
    const r = await markPolicyPaid(ctx.scope, id, { amountPaise: Math.round(amountRupees * 100), note }, ctx.user.id);
    return r.nextDueDate
      ? `Marked paid. Next due ${r.nextDueDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}.`
      : 'Marked paid. This one-time policy is now closed.';
  });
}

export async function setStatus(id: string, status: 'active' | 'not_renewing' | 'closed', reason: string | null) {
  return guard(async () => {
    const ctx = await requireContext();
    await setPolicyStatus(ctx.scope, id, status, reason);
  });
}

export async function whatsappFor(id: string) {
  const ctx = await requireContext();
  const store = ctx.scope.kind === 'single' ? ctx.stores.find((s) => s.id === (ctx.scope as { storeId: string }).storeId) : null;
  return renewalMessage(ctx.scope, id, store?.name ?? ctx.organization.name);
}

export async function historyFor(id: string) {
  const ctx = await requireContext();
  return policyHistory(ctx.scope, id);
}
