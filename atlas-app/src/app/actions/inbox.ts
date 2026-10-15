'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { markRead, myChannelSettings, myNotifications, saveMyChannels, type ChannelSettings } from '@/server/notify';
import { runRemindersForScope } from '@/server/reminders';
import {
  addReminder, completeReminder, deleteReminder, myReminders, reminderTargets, ReminderError, snoozeReminder,
} from '@/server/reminders';
import { ApprovalInboxError, decideFromInbox, myRequests, waitingOn } from '@/server/approvals';
import { ApprovalStepRecorded } from '@/server/approval-hooks';
import { HierarchyError } from '@/server/hierarchy';
import { friendlyError } from '@/lib/friendly-error';
import { DeskError, myDeskOptions, myDeskRequests, raiseDeskRequest, teamFollowUp, type DeskRequestInput } from '@/server/my-desk';

/**
 * The bell and My Reminders & Requests (27 Sep 2026,
 * NOTIFICATIONS-APPROVALS-SPEC.md §2-3). Everything here is about the
 * signed-in person; the owner can additionally see everyone's waiting items.
 */
export interface Result { ok?: boolean; error?: string; message?: string }

function friendly(e: unknown): Result {
  if (e instanceof ApprovalStepRecorded) return { ok: true, message: e.message };
  if (e instanceof Error && e.name === 'StoreScopeError') return { error: friendlyError(e) };
  if (e instanceof ApprovalInboxError || e instanceof ReminderError || e instanceof HierarchyError) return { error: e.message };
  if (e instanceof Error && e.message && e.message.length < 200) return { error: e.message };
  console.error('[inbox] action failed', e);
  return { error: 'Something went wrong. Please try again.' };
}

/** The bell: stored notifications (and, while here, due reminders are generated - throttled). */
export async function loadBellAction() {
  const ctx = await requireContext();
  await runRemindersForScope(ctx.scope).catch(() => undefined);
  return myNotifications(ctx.scope, ctx.user.id, 20);
}

export async function markReadAction(ids: string[] | 'all') {
  const ctx = await requireContext();
  await markRead(ctx.user.id, ids);
  return { ok: true };
}

export async function inboxAction(everyone = false) {
  const ctx = await requireContext();
  const isOwner = ctx.permissions.has('settings.edit');
  const [waiting, requests, reminders, notes] = await Promise.all([
    waitingOn(ctx.scope, ctx.user.id, { everyone: everyone && isOwner, permissions: ctx.permissions }),
    // Full history: My Desk filters by date now (9 Oct 2026).
    myRequests(ctx.scope, ctx.user.id, true),
    myReminders(ctx.scope, ctx.user.id),
    myNotifications(ctx.scope, ctx.user.id, 100),
  ]);
  return { waiting, requests, reminders, notifications: notes, isOwner, me: ctx.user.id };
}

/**
 * My Desk's notifications for a date window (9 Oct 2026). The tab loads the
 * newest 100; picking "Last month" asks for last month's, up to 500.
 * Bad dates are ignored rather than trusted.
 */
export async function notificationsAction(fromIso: string | null, toIso: string | null) {
  const ctx = await requireContext();
  const day = (v: string | null) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : undefined;
  };
  const gte = day(fromIso);
  const lt = day(toIso);
  return myNotifications(ctx.scope, ctx.user.id, 500, gte || lt ? { gte, lt } : undefined);
}

export async function decideAction(type: string, entityId: string, decision: 'approved' | 'rejected', note: string | null): Promise<Result> {
  try {
    const ctx = await requireContext();
    await decideFromInbox(ctx.scope, type, entityId, decision, ctx.user.id, note, ctx.permissions);
    revalidatePath('/my/reminders');
    return { ok: true };
  } catch (e) {
    return friendly(e);
  }
}

export async function addReminderAction(input: { title: string; note: string | null; dueAt: string; repeat: string; forUserId?: string | null }): Promise<Result> {
  try {
    const ctx = await requireContext();
    await addReminder(ctx.scope, ctx.user.id, { ...input, dueAt: new Date(input.dueAt) }, ctx.permissions);
    return { ok: true };
  } catch (e) {
    return friendly(e);
  }
}

/** Who this person may set a reminder for - themselves, their team, or (owner / admin) anybody in the branch. */
export async function reminderTargetsAction() {
  const ctx = await requireContext();
  return reminderTargets(ctx.scope, ctx.user.id, ctx.permissions);
}

export async function reminderAction(id: string, op: 'done' | 'delete' | 'snooze', until?: string): Promise<Result> {
  try {
    const ctx = await requireContext();
    if (op === 'done') await completeReminder(ctx.scope, ctx.user.id, id);
    else if (op === 'delete') await deleteReminder(ctx.scope, ctx.user.id, id);
    else await snoozeReminder(ctx.scope, ctx.user.id, id, new Date(until ?? ''));
    return { ok: true };
  } catch (e) {
    return friendly(e);
  }
}

export async function myChannelsAction() {
  const ctx = await requireContext();
  if (ctx.scope.kind !== 'single') return null;
  return myChannelSettings(ctx.scope.storeId, ctx.user.id);
}

export async function saveMyChannelsAction(channels: ChannelSettings['channels']): Promise<Result> {
  const ctx = await requireContext();
  if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first.' };
  await saveMyChannels(ctx.scope.storeId, ctx.user.id, channels);
  return { ok: true };
}

// ------------------------------------------------------------------ My Desk (S2)

/** My own requests (every kind) and what the New request form needs. */
export async function deskAction() {
  const ctx = await requireContext();
  const [requests, options] = await Promise.all([
    myDeskRequests(ctx.scope, ctx.user.id, true),
    myDeskOptions(ctx.scope, ctx.user.id),
  ]);
  return { requests, options, singleStore: ctx.scope.kind === 'single' };
}

/** Raise a request for myself. No admin permission: it is my own request. */
export async function raiseDeskAction(input: DeskRequestInput): Promise<Result> {
  try {
    const ctx = await requireContext();
    await raiseDeskRequest(ctx.scope, ctx.user.id, input);
    revalidatePath('/my/reminders');
    return { ok: true, message: 'Request sent. You will be notified when it is decided.' };
  } catch (e) {
    if (e instanceof DeskError) return { error: e.message };
    return friendly(e);
  }
}

/** Owner only: who has unread notifications, overdue reminders or approvals waiting. */
export async function teamFollowUpAction() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('settings.edit')) return [];
  return teamFollowUp(ctx.scope);
}
