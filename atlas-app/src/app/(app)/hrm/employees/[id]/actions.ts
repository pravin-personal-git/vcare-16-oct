'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { guardPersonPage } from '@/server/people-reach';

/**
 * Scorecard actions (31 Oct 2026): a manager clears a miss that was not this
 * person's fault, or records a reward or a private note. Both are kept with who
 * did it; nothing is deleted.
 */

type Result = { ok?: true; error?: string };

async function managerOf(userId: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) throw new Error('Only someone who can change employees can do this.');
  if (userId === ctx.user.id) throw new Error('You cannot clear or reward your own scorecard.');
  await guardPersonPage(ctx, userId, `/hrm/employees/${userId}`);
  const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : ctx.stores[0]?.id;
  if (!storeId) throw new Error('Choose a branch first.');
  return { ctx, storeId };
}

export async function clearMissAction(userId: string, ruleKey: string, refId: string, reason: string): Promise<Result> {
  try {
    const why = reason.trim();
    if (!why) return { error: 'Say why this was not a mistake.' };
    const { ctx, storeId } = await managerOf(userId);
    await db.scoreClearing.upsert({
      where: { subjectUserId_ruleKey_refId: { subjectUserId: userId, ruleKey: ruleKey.slice(0, 60), refId: refId.slice(0, 200) } },
      create: { storeId, subjectUserId: userId, ruleKey: ruleKey.slice(0, 60), refId: refId.slice(0, 200), reason: why.slice(0, 500), clearedBy: ctx.user.id },
      update: { reason: why.slice(0, 500), clearedBy: ctx.user.id },
    });
    revalidatePath(`/hrm/employees/${userId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not clear it.' };
  }
}

export async function addScoreNoteAction(userId: string, kind: 'reward' | 'note', body: string, amountRupees: number | null): Promise<Result> {
  try {
    const text = body.trim();
    if (!text) return { error: kind === 'reward' ? 'Say what the reward is for.' : 'Write the note.' };
    const amount = kind === 'reward' && amountRupees !== null && Number.isFinite(amountRupees) && amountRupees > 0 ? Math.round(amountRupees * 100) : null;
    const { ctx, storeId } = await managerOf(userId);
    await db.scoreNote.create({ data: { storeId, userId, kind: kind === 'reward' ? 'reward' : 'note', body: text.slice(0, 1000), amountPaise: amount, createdBy: ctx.user.id } });
    revalidatePath(`/hrm/employees/${userId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save it.' };
  }
}
