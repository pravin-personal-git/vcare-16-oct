import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * One person, and everything that can sign in as them (workstream I, 1 Oct 2026).
 *
 * WHY THIS MODULE EXISTS.
 *
 * A single employee's access is spread across four tables - the paired phone
 * (`CallSyncDevice`), its app session (`MobileRefreshToken`), its notification
 * token (`PushToken`) and their browser sessions (`LoginSession`) - and is
 * administered from six screens: users, roles, call-devices, login-sessions,
 * api-tokens, and biometric readers filed under `/holiday/`.
 *
 * Nowhere could you look at one employee and see their roles, their phone,
 * whether it is paired, and how to cut it off. That is not a cosmetic
 * complaint: when a technician loses a phone on a Friday evening, the person
 * who has to act needs one screen, not six.
 *
 * THE KILL SWITCH IS THE POINT.
 *
 * `revokeEverything` exists because doing it by hand means remembering three
 * tables while somebody is panicking. Missing one leaves a working session on
 * a phone in a stranger's pocket.
 */

export interface DeviceRow {
  id: string;
  kind: 'phone' | 'app_session' | 'browser' | 'push';
  label: string;
  detail: string | null;
  lastSeenAt: Date | null;
  /** Paired but never used, or an unspent pairing code. */
  pending: boolean;
}

export interface PersonRow {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  devices: DeviceRow[];
  /** Quick counts for the list, so a row is readable without expanding it. */
  phoneCount: number;
  browserCount: number;
  lastSeenAt: Date | null;
}

/**
 * Everyone in scope, with every way they can get in.
 *
 * Four queries rather than a join per person: the pooled connection runs one
 * statement at a time (`connection_limit=1`), so N+1 here would be one round
 * trip per employee on a screen that lists all of them.
 */
export async function peopleAndDevices(scope: StoreScope): Promise<PersonRow[]> {
  const users = await db.user.findMany({
    where: { storeRoles: { some: { ...scopeWhere(scope) } } },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    take: LIST_MAX_ROWS,
    select: {
      id: true, fullName: true, email: true, phone: true, isActive: true,
      storeRoles: {
        where: { ...scopeWhere(scope) },
        select: { role: { select: { name: true } } },
      },
    },
  });

  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);

  const [phones, appSessions, browsers, pushes] = await Promise.all([
    db.callSyncDevice.findMany({
      where: { userId: { in: ids }, ...scopeWhere(scope) },
      select: {
        id: true, userId: true, deviceLabel: true, deviceModel: true, appVersion: true,
        lastSyncedAt: true, pairingCode: true, pairingExpiresAt: true,
      },
    }),
    db.mobileRefreshToken.findMany({
      where: { userId: { in: ids }, revokedAt: null },
      select: { id: true, userId: true, deviceLabel: true, lastUsedAt: true, expiresAt: true },
    }),
    db.loginSession.findMany({
      where: { userId: { in: ids }, isRevoked: false, loggedOutAt: null },
      select: { id: true, userId: true, device: true, userAgent: true, ipAddress: true, lastActiveAt: true },
    }),
    db.pushToken.findMany({
      where: { userId: { in: ids } },
      select: { id: true, userId: true, deviceName: true, lastSeenAt: true },
    }),
  ]);

  const byUser = new Map<string, DeviceRow[]>(ids.map((id) => [id, []]));
  const push = (userId: string, row: DeviceRow) => byUser.get(userId)?.push(row);

  for (const p of phones) {
    const unpaired = Boolean(p.pairingCode) && !p.lastSyncedAt;
    push(p.userId, {
      id: p.id, kind: 'phone',
      label: p.deviceLabel || p.deviceModel || 'Paired phone',
      detail: [p.deviceModel, p.appVersion && `app ${p.appVersion}`].filter(Boolean).join(' · ') || null,
      lastSeenAt: p.lastSyncedAt,
      // A pairing code that was issued and never used is the commonest support
      // call on this screen - it needs to look different from a live phone.
      pending: unpaired,
    });
  }
  for (const a of appSessions) {
    push(a.userId, {
      id: a.id, kind: 'app_session',
      label: a.deviceLabel || 'Vcare app',
      detail: 'Signed in on the app',
      lastSeenAt: a.lastUsedAt,
      pending: false,
    });
  }
  for (const b of browsers) {
    push(b.userId, {
      id: b.id, kind: 'browser',
      label: b.device || 'Browser',
      detail: [b.userAgent?.slice(0, 60), b.ipAddress].filter(Boolean).join(' · ') || null,
      lastSeenAt: b.lastActiveAt,
      pending: false,
    });
  }
  for (const t of pushes) {
    push(t.userId, {
      id: t.id, kind: 'push',
      label: t.deviceName || 'Notifications',
      detail: 'Receives push notifications',
      lastSeenAt: t.lastSeenAt,
      pending: false,
    });
  }

  return users.map((u) => {
    const devices = (byUser.get(u.id) ?? []).sort(
      (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
    );
    return {
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      roleNames: [...new Set(u.storeRoles.map((r) => r.role?.name).filter((n): n is string => !!n))].sort(),
      devices,
      phoneCount: devices.filter((d) => d.kind === 'phone' && !d.pending).length,
      browserCount: devices.filter((d) => d.kind === 'browser').length,
      lastSeenAt: devices[0]?.lastSeenAt ?? null,
    };
  });
}

export interface RevokeResult {
  phones: number;
  appSessions: number;
  browsers: number;
  pushTokens: number;
}

/**
 * Lost or stolen phone: cut off everything at once.
 *
 * All four in ONE transaction. Revoking them one call at a time leaves a
 * window where the phone still has a working app session because the second
 * request had not landed yet - which is precisely the window this exists to
 * close.
 *
 * Nothing is deleted. The paired device is deactivated and the tokens are
 * marked revoked, so the audit trail still says which phone it was and when
 * it was cut off (AGENTS.md section 4).
 */
export async function revokeEverything(
  scope: StoreScope, userId: string,
): Promise<RevokeResult> {
  const storeId = scopeForWrite(scope);

  const person = await db.user.findFirst({
    where: { id: userId, storeRoles: { some: { storeId } } },
    select: { id: true },
  });
  if (!person) throw new Error('That person is not in your branch.');

  const now = new Date();
  const [phones, appSessions, browsers, pushTokens] = await db.$transaction([
    db.callSyncDevice.updateMany({
      where: { userId, storeId, isActive: true },
      data: { isActive: false, pairingCode: null, pairingExpiresAt: null },
    }),
    db.mobileRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    db.loginSession.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, loggedOutAt: now },
    }),
    // A push token is the one thing genuinely deleted: it is a handle issued by
    // Google, not a record of anything that happened, and a revoked phone must
    // stop receiving this business's notifications immediately.
    db.pushToken.deleteMany({ where: { userId } }),
  ]);

  return {
    phones: phones.count,
    appSessions: appSessions.count,
    browsers: browsers.count,
    pushTokens: pushTokens.count,
  };
}
