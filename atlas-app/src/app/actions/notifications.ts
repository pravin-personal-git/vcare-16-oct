'use server';

import { requireContext } from '@/server/context';
import { getNotifications, type NotificationItem } from '@/server/notifications';

export async function loadNotificationsAction(): Promise<NotificationItem[]> {
  const ctx = await requireContext();
  return getNotifications(ctx.scope, ctx.permissions);
}
