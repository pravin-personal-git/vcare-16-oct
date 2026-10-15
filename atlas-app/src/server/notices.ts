import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * Common Hub - Notices & Announcements. Feeds the dashboard panel that
 * otherwise reads "No notices at this time".
 */

export class NoticeError extends Error {}

// Re-exported from lib/notices.ts, not declared here - a client component
// cannot import a VALUE from a module marked `server-only`, even a plain
// constant array. See PLATFORM-COMPLETION.md's traps list.
export { NOTICE_CATEGORIES } from '@/lib/notices';

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: Date | null;
  isExpired: boolean;
  createdByName: string | null;
  createdAt: Date;
}

/** Notices currently worth showing - not expired. Used by the dashboard panel and, with `all`, by the list screen. */
export async function listNotices(scope: StoreScope, opts: { includeExpired?: boolean } = {}): Promise<NoticeRow[]> {
  const now = new Date();
  const rows = await db.notice.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.includeExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  });

  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    pinned: r.pinned,
    expiresAt: r.expiresAt,
    isExpired: r.expiresAt !== null && r.expiresAt <= now,
    createdByName: r.createdBy ? name.get(r.createdBy) ?? null : null,
    createdAt: r.createdAt,
  }));
}

export interface NoticeInput {
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: Date | null;
}

function validate(input: NoticeInput) {
  if (!input.title.trim()) throw new NoticeError('Title is required.');
  if (!input.body.trim()) throw new NoticeError('Notice text is required.');
}

export async function createNotice(scope: StoreScope, input: NoticeInput, userId: string) {
  const storeId = scopeForWrite(scope);
  validate(input);

  return db.notice.create({
    data: {
      storeId,
      title: input.title.trim(),
      body: input.body.trim(),
      category: input.category,
      pinned: input.pinned,
      expiresAt: input.expiresAt,
      createdBy: userId,
    },
  });
}

export async function updateNotice(scope: StoreScope, id: string, input: NoticeInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.notice.findFirst({ where: { id, storeId } });
  if (!found) throw new NoticeError('That notice is not in your scope.');

  return db.notice.update({
    where: { id },
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      category: input.category,
      pinned: input.pinned,
      expiresAt: input.expiresAt,
    },
  });
}

export async function deleteNotice(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const storeId = scopeForWrite(scope);
  const found = await db.notice.findFirst({ where: { id, storeId } });
  if (!found) throw new NoticeError('That notice is not in your scope.');
  // Tombstoned, not removed (3 Oct 2026). A notice people have acknowledged must
  // not come back from another machine after it was withdrawn.
  await db.notice.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}
