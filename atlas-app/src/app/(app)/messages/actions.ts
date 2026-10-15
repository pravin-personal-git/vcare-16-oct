'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  listConversations, listThread, markThreadRead, sendMessage, listOrgUsers,
  getUnreadCount, MessageError,
} from '@/server/messages';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

export async function loadConversationsAction() {
  const ctx = await requireContext();
  return listConversations(ctx.organization.id, ctx.user.id);
}

export async function loadOrgUsersAction() {
  const ctx = await requireContext();
  return listOrgUsers(ctx.organization.id, ctx.user.id);
}

export async function loadThreadAction(otherUserId: string) {
  const ctx = await requireContext();
  await markThreadRead(ctx.organization.id, ctx.user.id, otherUserId);
  return listThread(ctx.organization.id, ctx.user.id, otherUserId);
}

export async function loadUnreadCountAction() {
  const ctx = await requireContext();
  return getUnreadCount(ctx.organization.id, ctx.user.id);
}

export async function sendMessageAction(recipientId: string, body: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await sendMessage(ctx.organization.id, ctx.user.id, recipientId, body);
    revalidatePath('/messages');
    return { ok: true };
  } catch (err) {
    if (err instanceof MessageError) return { error: err.message };
    console.error('[messages] send failed', err);
    return { error: 'Could not send that message. Please try again.' };
  }
}
