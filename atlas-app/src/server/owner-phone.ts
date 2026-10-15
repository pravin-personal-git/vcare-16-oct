import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { istDayStart } from '@/lib/ist';
import { istDay } from '@/lib/renewal-cycle';
import { slaChecks, SLA_START } from '@/lib/job-sla';
import { getJobSettings } from './job-settings';
import { waitingOn } from './approvals';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import { newShopRequestCount } from './shop-requests';

/**
 * THE OWNER'S HOME ON THE PHONE (13 Oct 2026, decision 11 option B).
 *
 * Pravin: the admin login on the phone is "pathetic" - it was the whole
 * website squeezed into a WebView. This is the owner's day in one native
 * screen: what sold today, what is owed, the jobs (open, late, nobody on
 * them), and what waits on the owner. The full website is one tap away.
 *
 * Money uses the Accounts dashboard's rules (issued invoices, received
 * receipts), late uses the job-deadline engine - so this screen, the 8 AM
 * summary and the website never disagree.
 */
const DONE = ['resolved', 'closed', 'cancelled'];

export async function ownerSummary(scope: StoreScope, userId: string, permissions: ReadonlySet<string>, now: Date = new Date()) {
  const where = scopeWhere(scope);
  const todayStart = istDayStart(istDay(now));
  const [sales, collected, openInvoices, openJobs, unassigned, approvals, myReminders] = await Promise.all([
    db.invoice.aggregate({ where: { ...where, lifecycle: 'sent', deletedAt: null, invoiceDate: { gte: todayStart } }, _sum: { grandTotalPaise: true }, _count: true }),
    db.receipt.aggregate({ where: { ...where, status: 'received', deletedAt: null, receivedAt: { gte: todayStart } }, _sum: { amountPaise: true }, _count: true }),
    db.invoice.findMany({ where: { ...where, lifecycle: 'sent', deletedAt: null }, select: { dueDate: true, grandTotalPaise: true, amountPaidPaise: true }, take: LIST_MAX_ROWS }),
    db.complaint.findMany({
      where: { ...where, status: { notIn: [...DONE, 'awaiting_customer', 'awaiting_estimate'] }, createdAt: { gte: SLA_START }, legacyRef: null },
      select: {
        storeId: true, status: true, priority: true, createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true,
        visits: { where: { checkedInAt: { not: null } }, select: { id: true }, take: 1 },
      },
      take: FEED_MAX_ROWS,
    }),
    db.complaint.findMany({
      where: { ...where, status: { notIn: DONE }, assignedTechnicianId: null },
      select: {
        id: true, complaintNo: true, description: true, priority: true, createdAt: true, siteLocation: true,
        customer: { select: { firstName: true, lastName: true, companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    waitingOn(scope, userId, { everyone: permissions.has('settings.edit'), permissions }).catch(() => []),
    db.personalReminder.count({ where: { ...where, userId, doneAt: null, dueAt: { lt: new Date(todayStart.getTime() + 86_400_000) } } }),
  ]);

  let toCollectPaise = 0, overduePaise = 0;
  for (const i of openInvoices) {
    const owed = Math.max(0, i.grandTotalPaise - i.amountPaidPaise);
    toCollectPaise += owed;
    if (i.dueDate < todayStart) overduePaise += owed;
  }

  const settings = new Map<string, Awaited<ReturnType<typeof getJobSettings>>>();
  for (const id of new Set(openJobs.map((j) => j.storeId))) settings.set(id, await getJobSettings(id));
  const late = openJobs.filter((j) => slaChecks({
    status: j.status, priority: j.priority, createdAt: j.createdAt, assignedAt: j.assignedAt,
    arrived: !!j.onSiteSince || j.timeOnSiteSec > 0 || j.visits.length > 0,
  }, settings.get(j.storeId)!.sla, now).some((c) => c.state === 'missed')).length;
  const allOpen = await db.complaint.count({ where: { ...where, status: { notIn: DONE } } });

  return {
    today: istDay(now),
    salesPaise: sales._sum.grandTotalPaise ?? 0, invoiceCount: sales._count,
    collectedPaise: collected._sum.amountPaise ?? 0, receiptCount: collected._count,
    toCollectPaise, overduePaise,
    jobs: { open: allOpen, late, unassigned: unassigned.length },
    unassigned: unassigned.map((c) => ({
      id: c.id, complaintNo: c.complaintNo, description: c.description, priority: c.priority, createdAt: c.createdAt.toISOString(),
      siteLocation: c.siteLocation,
      customerName: c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' ') || 'Customer',
    })),
    approvalsWaiting: approvals.length,
    remindersToday: myReminders,
    // Customers waiting from the online shop with nobody on them yet (13 Oct 2026).
    shopRequestsNew: await newShopRequestCount(scope).catch(() => 0),
  };
}
