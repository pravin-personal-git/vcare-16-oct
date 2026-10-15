'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  raiseHelpdeskTicket, addHelpdeskComment, assignHelpdeskTicket, setHelpdeskTicketStatus,
  listHelpdeskComments, listHelpdeskAssignableUsers,
  createHelpdeskCategory, removeHelpdeskCategory,
  HelpdeskError, type TicketInput, type TicketStatus,
} from '@/server/helpdesk';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

function canViewAll(permissions: Set<string>): boolean {
  return permissions.has('helpdesk.view') || permissions.has('helpdesk.edit');
}

async function guardEdit(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('helpdesk.edit')) {
      return { error: 'You do not have permission to manage the helpdesk.' };
    }
    await run();
    revalidatePath('/helpdesk');
    return { ok: true };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    console.error('[helpdesk] action failed', err);
    return { error: friendlyError(err) };
  }
}

// -------------------------------------------------------- tickets & comments
// Deliberately NOT behind an admin guard - raising a ticket, and commenting
// on or reopening your own, needs no permission, the same as asset_request.

export async function raiseTicketAction(input: TicketInput): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await raiseHelpdeskTicket(ctx.scope, input, ctx.user.id);
    revalidatePath('/helpdesk');
    return { ok: true };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    console.error('[helpdesk] raise ticket failed', err);
    return { error: friendlyError(err) };
  }
}

export async function addCommentAction(ticketId: string, body: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await addHelpdeskComment(ctx.scope, ticketId, body, { userId: ctx.user.id, canViewAll: canViewAll(ctx.permissions) });
    revalidatePath('/helpdesk');
    return { ok: true };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    console.error('[helpdesk] comment failed', err);
    return { error: friendlyError(err) };
  }
}

export async function setStatusAction(ticketId: string, status: TicketStatus, note: string | null): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setHelpdeskTicketStatus(ctx.scope, ticketId, status, note, { userId: ctx.user.id, canViewAll: canViewAll(ctx.permissions) });
    revalidatePath('/helpdesk');
    return { ok: true };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    console.error('[helpdesk] status change failed', err);
    return { error: friendlyError(err) };
  }
}

export async function fetchCommentsAction(ticketId: string) {
  try {
    const ctx = await requireContext();
    const rows = await listHelpdeskComments(ctx.scope, ticketId, { userId: ctx.user.id, canViewAll: canViewAll(ctx.permissions) });
    return { data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    return { error: 'Could not load comments.' };
  }
}

// ------------------------------------------------------------ support-team actions

export async function assignTicketAction(ticketId: string, assigneeId: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await assignHelpdeskTicket(ctx.scope, ticketId, assigneeId, ctx.user.id);
  });
}

export async function fetchAssignableUsersAction() {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('helpdesk.edit')) return { error: 'You do not have permission to manage the helpdesk.' };
    const users = await listHelpdeskAssignableUsers(ctx.scope);
    return { data: users };
  } catch {
    return { error: 'Could not load the user list.' };
  }
}

export async function createCategoryAction(name: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createHelpdeskCategory(ctx.scope, name);
  });
}

export async function removeCategoryAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await removeHelpdeskCategory(ctx.scope, id);
  });
}
