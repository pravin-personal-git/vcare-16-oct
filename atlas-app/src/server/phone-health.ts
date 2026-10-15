import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { deviceStatus } from '@/lib/device-trust';

/**
 * Phones that have gone quiet (health check CALL-5, 25 Sep 2026).
 *
 * "Not reporting" used to exist only as a label worked out when somebody
 * opened the Phones page - nothing was recorded and nobody was told. This
 * records the moment a paired phone goes quiet (a `not_reporting` event, once)
 * and the moment it comes back (`reporting_again`, also written by check-in),
 * and returns the counts the notification bell shows to people who look
 * after phones. Run when those people load a page, and nightly by cron as a
 * backstop - no always-on job needed.
 */
export interface PhoneHealth {
  notReporting: number;
  appRemoved: number;
  fakeLocationToday: number;
}

export async function checkPhoneHealth(scope: StoreScope, now: Date = new Date()): Promise<PhoneHealth> {
  const where = scopeWhere(scope);
  const devices = await db.callSyncDevice.findMany({
    where: { ...where, isActive: true },
    select: {
      id: true, storeId: true, userId: true, isActive: true, lastSyncedAt: true, appRemovedAt: true, pairedAt: true,
      mockLocationSeenAt: true,
    },
  });
  if (devices.length === 0) return { notReporting: 0, appRemoved: 0, fakeLocationToday: 0 };

  const [open, lastEvents] = await Promise.all([
    db.attendanceSession.findMany({
      where: { ...where, endedAt: null, deviceId: { in: devices.map((d) => d.id) } },
      select: { deviceId: true },
    }),
    db.deviceEvent.findMany({
      where: { ...where, deviceId: { in: devices.map((d) => d.id) }, kind: { in: ['not_reporting', 'reporting_again'] } },
      orderBy: { createdAt: 'desc' },
      distinct: ['deviceId'],
      select: { deviceId: true, kind: true },
    }),
  ]);
  const onShift = new Set(open.map((o) => o.deviceId));
  const last = new Map(lastEvents.map((e) => [e.deviceId, e.kind]));

  let notReporting = 0;
  let appRemoved = 0;
  const events: { storeId: string; deviceId: string; userId: string; kind: string }[] = [];
  for (const d of devices) {
    const s = deviceStatus(d, onShift.has(d.id), now);
    if (s === 'app_removed') appRemoved += 1;
    if (s === 'not_reporting') {
      notReporting += 1;
      if (last.get(d.id) !== 'not_reporting') events.push({ storeId: d.storeId, deviceId: d.id, userId: d.userId, kind: 'not_reporting' });
    } else if (s === 'active' && last.get(d.id) === 'not_reporting') {
      events.push({ storeId: d.storeId, deviceId: d.id, userId: d.userId, kind: 'reporting_again' });
    }
  }
  if (events.length) await db.deviceEvent.createMany({ data: events });

  const dayStart = new Date(now.getTime() - 24 * 3_600_000);
  const fakeLocationToday = devices.filter((d) => d.mockLocationSeenAt && d.mockLocationSeenAt > dayStart).length;
  return { notReporting, appRemoved, fakeLocationToday };
}
