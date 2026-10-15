import 'server-only';
import { db } from './db';
import { verifyPassword } from './auth/password';

/**
 * "Switch Business" - a personal quick-switch between two logins the same
 * physical person controls, for an owner who runs more than one business on
 * Atlas (each a fully separate `Organization`, fully isolated).
 *
 * Deliberately NOT a way to hold one identity across multiple organisations -
 * that would mean restructuring `User.organizationId`, the single
 * highest-severity area in this codebase's tenant isolation. Each business
 * keeps its own separate login exactly as it does today; this only remembers
 * "I proved I control this other account once" (by entering its password
 * here, verified below, never stored) so switching later doesn't ask again.
 */

export class LinkedAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedAccountError';
  }
}

export interface LinkedAccountRow {
  linkedUserId: string;
  fullName: string;
  username: string;
  organizationName: string;
  label: string | null;
}

export async function listLinkedAccounts(ownerUserId: string): Promise<LinkedAccountRow[]> {
  const rows = await db.linkedAccount.findMany({
    where: { ownerUserId },
    select: {
      linkedUserId: true, label: true,
      linked: { select: { fullName: true, username: true, organization: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    linkedUserId: r.linkedUserId,
    fullName: r.linked.fullName,
    username: r.linked.username,
    // `organization` is nullable since the platform-ownership phase (a
    // Platform/Reseller user has none) - Switch Business links two TENANT
    // logins, so this is never actually null in practice, but the fallback
    // costs nothing and keeps this from ever crashing if it somehow were.
    organizationName: r.linked.organization?.name ?? '—',
    label: r.label,
  }));
}

/**
 * Links a second account to this one, in both directions, after verifying
 * the caller actually knows that account's password. The password itself is
 * never stored - only the fact that ownership was proven.
 */
export async function linkAccount(
  ownerUserId: string, targetUsername: string, targetPassword: string,
): Promise<void> {
  // Same lowercasing as login/actions.ts - createUser always lowercases on
  // save, so this lookup must match that convention or a username typed in
  // its "natural" case (e.g. an org name in caps) never matches.
  const target = await db.user.findUnique({ where: { username: targetUsername.trim().toLowerCase() } });
  if (!target || !(await verifyPassword(targetPassword, target.passwordHash))) {
    throw new LinkedAccountError('Incorrect username or password for that account.');
  }
  if (target.id === ownerUserId) {
    throw new LinkedAccountError('That is already the account you are signed in as.');
  }
  if (!target.isActive) {
    throw new LinkedAccountError('That account is inactive.');
  }

  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerUserId }, select: { fullName: true } });

  await db.$transaction([
    db.linkedAccount.upsert({
      where: { ownerUserId_linkedUserId: { ownerUserId, linkedUserId: target.id } },
      update: {},
      create: { ownerUserId, linkedUserId: target.id },
    }),
    db.linkedAccount.upsert({
      where: { ownerUserId_linkedUserId: { ownerUserId: target.id, linkedUserId: ownerUserId } },
      update: {},
      create: { ownerUserId: target.id, linkedUserId: ownerUserId, label: owner.fullName },
    }),
  ]);
}

export async function unlinkAccount(ownerUserId: string, linkedUserId: string): Promise<void> {
  await db.$transaction([
    db.linkedAccount.deleteMany({ where: { ownerUserId, linkedUserId } }),
    db.linkedAccount.deleteMany({ where: { ownerUserId: linkedUserId, linkedUserId: ownerUserId } }),
  ]);
}

/** Confirms the link exists before the caller creates a new session for it. */
export async function canSwitchTo(ownerUserId: string, linkedUserId: string): Promise<boolean> {
  const link = await db.linkedAccount.findUnique({
    where: { ownerUserId_linkedUserId: { ownerUserId, linkedUserId } },
  });
  return link !== null;
}
