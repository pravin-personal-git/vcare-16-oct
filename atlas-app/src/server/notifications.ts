import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { checkPhoneHealth } from './phone-health';
import { canPairPhones } from '@/lib/device-trust';

/**
 * The header rail's Notifications bell.
 *
 * Deliberately not a stored, pushed notification - there is no background
 * worker to push one from yet (that is Phase 6). This computes the same kind
 * of thing the dashboard's own Insights panel shows, live, at request time,
 * from the same underlying tables. It will not tell you about something that
 * happened five minutes ago on a screen you are not looking at; it will
 * always agree with what a fresh page load of the relevant screen shows,
 * because it is the same query.
 */

export type NotificationLevel = 'critical' | 'info' | 'review';

export interface NotificationItem {
  id: string;
  level: NotificationLevel;
  title: string;
  body: string;
  href: string;
}

export async function getNotifications(scope: StoreScope, permissions?: ReadonlySet<string>): Promise<NotificationItem[]> {
  const where = scopeWhere(scope);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

  const [balances, orders] = await Promise.all([
    db.productBalance.findMany({
      where: { product: { ...where, isActive: true } },
      select: { currentQty: true, reorderLevel: true, lastSoldAt: true },
    }),
    db.salesOrder.findMany({
      where,
      select: { grandTotalPaise: true, amountPaidPaise: true },
    }),
  ]);

  const outOfStock = balances.filter((b) => b.currentQty <= 0).length;
  const timeForPo = balances.filter((b) => b.currentQty > 0 && b.currentQty <= b.reorderLevel).length;
  const nonMoving = balances.filter((b) => !b.lastSoldAt || b.lastSoldAt < ninetyDaysAgo).length;
  const outstandingPaise = orders.reduce((sum, o) => {
    const owed = o.grandTotalPaise - o.amountPaidPaise;
    return owed > 0 ? sum + owed : sum;
  }, 0);

  const items: NotificationItem[] = [];
  if (outOfStock > 0) {
    items.push({
      id: 'out-of-stock', level: 'critical',
      title: `${outOfStock} item${outOfStock === 1 ? '' : 's'} out of stock`,
      body: 'Raise purchase orders before the lead-time gap widens.',
      href: '/products',
    });
  }
  if (timeForPo > 0) {
    items.push({
      id: 'time-for-po', level: 'info',
      title: `${timeForPo} item${timeForPo === 1 ? '' : 's'} need a purchase order`,
      body: 'Stock at or below reorder level.',
      href: '/purchase/orders',
    });
  }
  if (nonMoving > 0) {
    items.push({
      id: 'non-moving', level: 'review',
      title: `${nonMoving} non-moving stock item${nonMoving === 1 ? '' : 's'}`,
      body: 'No sales in the last 90 days.',
      href: '/products',
    });
  }
  if (outstandingPaise > 0) {
    items.push({
      id: 'outstanding', level: 'review',
      title: `${(outstandingPaise / 100).toLocaleString('en-IN')} outstanding on sales orders`,
      body: 'Money booked but not received.',
      href: '/sales/orders',
    });
  }
  // Phones that stopped reporting, were uninstalled, or sent a fake
  // location - for the people who look after phones (CALL-5).
  if (permissions && canPairPhones(permissions as Set<string>)) {
    const phones = await checkPhoneHealth(scope).catch(() => null);
    if (phones && phones.notReporting + phones.appRemoved > 0) {
      const n = phones.notReporting + phones.appRemoved;
      items.unshift({
        id: 'phones-quiet', level: 'critical',
        title: `${n} phone${n === 1 ? '' : 's'} not reporting`,
        body: phones.appRemoved
          ? `${phones.appRemoved} with the app removed. Attendance, location and calls are not arriving.`
          : 'Attendance, location and calls are not arriving from them.',
        href: '/settings/call-devices',
      });
    }
    if (phones && phones.fakeLocationToday > 0) {
      items.unshift({
        id: 'phones-fake-location', level: 'critical',
        title: `Fake location on ${phones.fakeLocationToday} phone${phones.fakeLocationToday === 1 ? '' : 's'} today`,
        body: 'A location-spoofing app reported a position. Check Team Today.',
        href: '/attendance/team-today',
      });
    }
  }
  return items;
}
