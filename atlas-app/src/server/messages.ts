import 'server-only';
import { db } from './db';

/**
 * Header rail Messages - a direct message between two people in the same
 * organisation. Organisation-scoped, not store-scoped - see the model's own
 * comment in schema.prisma for why.
 */

export class MessageError extends Error {}

export interface ConversationRow {
  otherUserId: string;
  otherUserName: string;
  lastBody: string;
  lastAt: Date;
  unreadCount: number;
}

/** Every person this user has exchanged a message with, most recent first. */
export async function listConversations(organizationId: string, userId: string): Promise<ConversationRow[]> {
  const rows = await db.message.findMany({
    where: { organizationId, OR: [{ senderId: userId }, { recipientId: userId }] },
    orderBy: { createdAt: 'desc' },
    select: {
      senderId: true, recipientId: true, body: true, createdAt: true, readAt: true,
      sender: { select: { fullName: true } },
      recipient: { select: { fullName: true } },
    },
  });

  const byOther = new Map<string, ConversationRow>();
  for (const r of rows) {
    const otherId = r.senderId === userId ? r.recipientId : r.senderId;
    const otherName = r.senderId === userId ? r.recipient.fullName : r.sender.fullName;
    const existing = byOther.get(otherId);
    if (!existing) {
      byOther.set(otherId, {
        otherUserId: otherId,
        otherUserName: otherName,
        lastBody: r.body,
        lastAt: r.createdAt,
        unreadCount: r.recipientId === userId && !r.readAt ? 1 : 0,
      });
    } else if (r.recipientId === userId && !r.readAt) {
      existing.unreadCount += 1;
    }
  }
  return [...byOther.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export interface MessageRow {
  id: string;
  body: string;
  createdAt: Date;
  fromMe: boolean;
}

/** The full thread with one other person, oldest first - the natural reading order for a chat. */
export async function listThread(organizationId: string, userId: string, otherUserId: string): Promise<MessageRow[]> {
  const rows = await db.message.findMany({
    where: {
      organizationId,
      OR: [
        { senderId: userId, recipientId: otherUserId },
        { senderId: otherUserId, recipientId: userId },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, fromMe: r.senderId === userId }));
}

/** Marks every message this person received from that counterpart as read. */
export async function markThreadRead(organizationId: string, userId: string, otherUserId: string): Promise<void> {
  await db.message.updateMany({
    where: { organizationId, senderId: otherUserId, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function sendMessage(
  organizationId: string, senderId: string, recipientId: string, body: string,
): Promise<void> {
  if (!body.trim()) throw new MessageError('Message cannot be empty.');
  if (senderId === recipientId) throw new MessageError('You cannot message yourself.');

  const recipient = await db.user.findFirst({ where: { id: recipientId, organizationId } });
  if (!recipient) throw new MessageError('That person is not in your organisation.');

  await db.message.create({
    data: { organizationId, senderId, recipientId, body: body.trim() },
  });
}

export async function getUnreadCount(organizationId: string, userId: string): Promise<number> {
  return db.message.count({ where: { organizationId, recipientId: userId, readAt: null } });
}

/** Everyone else in the organisation, for starting a new conversation. */
export async function listOrgUsers(organizationId: string, excludingUserId: string): Promise<{ id: string; fullName: string }[]> {
  return db.user.findMany({
    where: { organizationId, id: { not: excludingUserId }, isActive: true },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
}
