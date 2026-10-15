import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { getJobSettings } from './job-settings';
import { slaChecks } from '@/lib/job-sla';
import { OFFICE_LABEL, type JobStatus } from '@/lib/job-flow';
import { stageLabel } from '@/lib/installation-stages';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { scheduleDay, sortWork, workRow, type ScheduleVisit, type WorkRow } from '@/lib/my-work';

/**
 * The technician's simple app (13 Oct 2026, HANDOFF-2026-10-13 §4.2): ONE
 * list of the complaints and installation jobs given to this person, and
 * their visits for today and tomorrow. Rules in lib/my-work.
 *
 * Strictly theirs - assigned to them, or with a visit of theirs - whatever
 * the role's "Complaints they see" says: the simple layout is for the person
 * doing the work, not the one watching it. Finished work leaves (decision 4):
 * a complaint once the technician's part is done (resolved = waiting for the
 * office to close), an installation once it is no longer pending.
 */
const OPEN_VISIT = { status: { notIn: ['completed', 'cancelled'] } };
const DONE = ['resolved', 'closed', 'cancelled'];

export async function myWork(scope: StoreScope, userId: string, opts: { withInstallations: boolean; withComplaints: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const [complaints, challans, visits] = await Promise.all([
    opts.withComplaints
      ? db.complaint.findMany({
        where: {
          ...scopeWhere(scope), status: { notIn: DONE },
          OR: [{ assignedTechnicianId: userId }, { visits: { some: { technicianId: userId, ...OPEN_VISIT } } }],
        },
        select: {
          id: true, storeId: true, complaintNo: true, description: true, status: true, priority: true, jobType: true,
          createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true, legacyRef: true,
          siteLocation: true, siteLat: true, siteLng: true,
          customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
          product: { select: { productName: true } },
          visits: {
            select: { id: true, technicianId: true, scheduledAt: true, status: true, checkedInAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: LIST_MAX_ROWS,
      })
      : [],
    opts.withInstallations
      ? db.installationChallan.findMany({
        where: { ...scopeWhere(scope), status: 'pending', assignees: { some: { userId } } },
        select: {
          id: true, challanNo: true, status: true, stage: true, priority: true, dispatchedAt: true, siteLocation: true,
          siteLat: true, siteLng: true,
          salesOrder: { select: { customerName: true, organizationName: true, shippingAddress: true, billingAddress: true, phone: true } },
          assignees: { where: { userId }, select: { assignedAt: true } },
          items: { select: { qty: true } },
          visits: { where: { technicianId: userId, ...OPEN_VISIT }, select: { id: true, technicianId: true, scheduledAt: true, status: true, checkedInAt: true } },
        },
        orderBy: { dispatchedAt: 'desc' },
        take: LIST_MAX_ROWS,
      })
      : [],
    db.serviceVisit.findMany({
      where: {
        technicianId: userId, ...OPEN_VISIT,
        OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }],
        // Today, tomorrow, and anything earlier not done yet.
        scheduledAt: { lt: new Date(now.getTime() + 2 * 86_400_000) },
      },
      select: {
        id: true, purpose: true, scheduledAt: true, checkedInAt: true, complaintId: true, installationChallanId: true,
        complaint: {
          select: {
            complaintNo: true, siteLocation: true, status: true,
            customer: { select: { firstName: true, lastName: true, companyName: true } },
          },
        },
        installationChallan: {
          select: { challanNo: true, siteLocation: true, status: true, salesOrder: { select: { customerName: true, organizationName: true, shippingAddress: true } } },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const settingsByStore = new Map<string, Awaited<ReturnType<typeof getJobSettings>>>();
  for (const id of new Set(complaints.map((c) => c.storeId))) settingsByStore.set(id, await getJobSettings(id));

  const person = (c: { firstName: string | null; lastName: string | null; companyName: string | null }) =>
    c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer';

  const rows: WorkRow[] = [
    ...complaints.map((c) => {
      const mine = c.visits.filter((v) => v.technicianId === userId && v.status !== 'completed' && v.status !== 'cancelled');
      const sla = settingsByStore.get(c.storeId)!.sla;
      const missed = slaChecks({
        status: c.status, priority: c.priority, createdAt: c.createdAt, assignedAt: c.assignedAt,
        arrived: !!c.onSiteSince || c.timeOnSiteSec > 0 || c.visits.some((v) => !!v.checkedInAt), migrated: !!c.legacyRef,
      }, sla, now).some((x) => x.state === 'missed');
      return workRow({
        kind: 'complaint', id: c.id, no: c.complaintNo, customerName: person(c.customer), siteLocation: c.siteLocation,
        problem: [c.product?.productName, c.description].filter(Boolean).join(' - '),
        status: c.status, statusLabel: OFFICE_LABEL[c.status as JobStatus] ?? c.status, priority: c.priority,
        givenAt: c.assignedAt ?? c.createdAt, visits: mine, slaMissed: missed,
        customerPhone: c.customer.phone, lat: c.siteLat ? Number(c.siteLat) : null, lng: c.siteLng ? Number(c.siteLng) : null,
      }, now);
    }),
    ...challans.map((ch) => {
      const qty = ch.items.reduce((t, i) => t + i.qty, 0);
      return workRow({
        kind: 'installation', id: ch.id, no: ch.challanNo,
        customerName: ch.salesOrder?.organizationName || ch.salesOrder?.customerName || 'No customer on the challan',
        siteLocation: ch.siteLocation ?? ch.salesOrder?.shippingAddress ?? ch.salesOrder?.billingAddress ?? null,
        problem: `Installation - ${qty} item${qty === 1 ? '' : 's'}`,
        status: ch.status, statusLabel: stageLabel(ch.stage), priority: ch.priority,
        givenAt: ch.assignees[0]?.assignedAt && ch.assignees[0].assignedAt > ch.dispatchedAt ? ch.assignees[0].assignedAt : ch.dispatchedAt,
        visits: ch.visits, customerPhone: ch.salesOrder?.phone ?? null,
        lat: ch.siteLat ? Number(ch.siteLat) : null, lng: ch.siteLng ? Number(ch.siteLng) : null,
      }, now);
    }),
  ];

  const schedule: ScheduleVisit[] = [];
  for (const v of visits) {
    const day = scheduleDay(v.scheduledAt, now);
    if (!day) continue;
    const isComplaint = !!v.complaint;
    // A job whose work is finished has no visit left to make.
    if (isComplaint ? DONE.includes(v.complaint!.status) : v.installationChallan && v.installationChallan.status !== 'pending') continue;
    if (!isComplaint && !v.installationChallan) continue;
    schedule.push({
      id: v.id, kind: isComplaint ? 'complaint' : 'installation',
      jobId: (isComplaint ? v.complaintId : v.installationChallanId)!,
      no: isComplaint ? v.complaint!.complaintNo : v.installationChallan!.challanNo,
      customerName: isComplaint
        ? person(v.complaint!.customer)
        : v.installationChallan!.salesOrder?.organizationName || v.installationChallan!.salesOrder?.customerName || 'No customer on the challan',
      siteLocation: isComplaint ? v.complaint!.siteLocation : (v.installationChallan!.siteLocation ?? v.installationChallan!.salesOrder?.shippingAddress ?? null),
      purpose: v.purpose, scheduledAt: v.scheduledAt.toISOString(), checkedIn: !!v.checkedInAt, day,
    });
  }

  return { jobs: sortWork(rows), schedule, now: now.toISOString() };
}
