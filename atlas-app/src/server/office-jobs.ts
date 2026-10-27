import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { getJobSettings } from './job-settings';
import { listTechnicians } from './complaints';
import { slaChecks } from '@/lib/job-sla';
import { OFFICE_LABEL, type JobStatus } from '@/lib/job-flow';
import { stageLabel } from '@/lib/installation-stages';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { sortWork, workRow, type WorkRow } from '@/lib/my-work';

/**
 * THE OFFICE JOB BOARD ON THE PHONE (13 Oct 2026, native admin app part 1,
 * ADMIN-NATIVE-APP-SPEC). Every open complaint and installation in the
 * branch - not one technician's - with who is on it, what is late and what
 * has nobody, for the owner's Service tab. The same lateness rule as the
 * technician's list and the website (lib/my-work + the job-deadline engine).
 *
 * Groups, for the status chips:
 *   unassigned - nobody on it;
 *   todo       - given, not started;
 *   working    - on the way / on site / installing;
 *   waiting    - on the customer or the office (estimate, customer's OK,
 *                work done waiting to close / approve).
 */
export type OfficeGroup = 'unassigned' | 'todo' | 'working' | 'waiting';

export interface OfficeJob extends WorkRow {
  group: OfficeGroup;
  technicianIds: string[];
  technicianNames: string[];
  createdAt: string;
}

const OPEN_VISIT = { status: { notIn: ['completed', 'cancelled'] } };
const DONE = ['closed', 'cancelled'];

function complaintGroup(status: string, assigned: boolean): OfficeGroup {
  if (!assigned || status === 'received') return 'unassigned';
  if (['on_the_way', 'on_site', 'in_progress'].includes(status)) return 'working';
  if (['awaiting_estimate', 'awaiting_customer', 'resolved'].includes(status)) return 'waiting';
  return 'todo';
}

export async function officeJobs(scope: StoreScope, now: Date = new Date()) {
  const where = scopeWhere(scope);
  const [complaints, challans, people] = await Promise.all([
    db.complaint.findMany({
      where: { ...where, status: { notIn: DONE } },
      select: {
        id: true, storeId: true, complaintNo: true, description: true, status: true, priority: true,
        createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true, legacyRef: true,
        siteLocation: true, siteLat: true, siteLng: true, assignedTechnicianId: true,
        customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
        product: { select: { productName: true } },
        visits: { where: OPEN_VISIT, select: { id: true, scheduledAt: true, status: true, checkedInAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    db.installationChallan.findMany({
      where: { ...where, status: { in: ['pending', 'work_done'] } },
      select: {
        id: true, challanNo: true, status: true, stage: true, priority: true, dispatchedAt: true, createdAt: true,
        siteLocation: true, siteLat: true, siteLng: true,
        salesOrder: { select: { customerName: true, organizationName: true, shippingAddress: true, phone: true } },
        customer: { select: { firstName: true, lastName: true, companyName: true, phone: true, phoneCc: true, addressLine1: true } },
        assignees: { select: { userId: true, assignedAt: true } },
        items: { select: { qty: true } },
        visits: { where: OPEN_VISIT, select: { id: true, scheduledAt: true, status: true, checkedInAt: true } },
      },
      orderBy: { dispatchedAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    listTechnicians(scope),
  ]);

  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const settings = new Map<string, Awaited<ReturnType<typeof getJobSettings>>>();
  for (const id of new Set(complaints.map((c) => c.storeId))) settings.set(id, await getJobSettings(id));
  const person = (c: { firstName: string | null; lastName: string | null; companyName: string | null }) =>
    c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer';

  const jobs: OfficeJob[] = [
    ...complaints.map((c) => {
      const missed = slaChecks({
        status: c.status, priority: c.priority, createdAt: c.createdAt, assignedAt: c.assignedAt,
        arrived: !!c.onSiteSince || c.timeOnSiteSec > 0 || c.visits.some((v) => !!v.checkedInAt), migrated: !!c.legacyRef,
      }, settings.get(c.storeId)!.sla, now).some((x) => x.state === 'missed');
      const row = workRow({
        kind: 'complaint', id: c.id, no: c.complaintNo, customerName: person(c.customer), siteLocation: c.siteLocation,
        problem: [c.product?.productName, c.description].filter(Boolean).join(' - '),
        status: c.status, statusLabel: OFFICE_LABEL[c.status as JobStatus] ?? c.status, priority: c.priority,
        givenAt: c.assignedAt ?? c.createdAt, visits: c.visits, slaMissed: missed, customerPhone: c.customer.phone,
        lat: c.siteLat ? Number(c.siteLat) : null, lng: c.siteLng ? Number(c.siteLng) : null,
      }, now);
      const tech = c.assignedTechnicianId;
      return {
        ...row, group: complaintGroup(c.status, !!tech), createdAt: c.createdAt.toISOString(),
        technicianIds: tech ? [tech] : [], technicianNames: tech ? [nameOf.get(tech) ?? 'Technician'] : [],
      };
    }),
    ...challans.map((ch) => {
      const qty = ch.items.reduce((t, i) => t + i.qty, 0);
      const row = workRow({
        kind: 'installation', id: ch.id, no: ch.challanNo,
        customerName: (ch.customer && (ch.customer.companyName || [ch.customer.firstName, ch.customer.lastName].filter(Boolean).join(' '))) || ch.salesOrder?.organizationName || ch.salesOrder?.customerName || 'No customer on the challan',
        siteLocation: ch.siteLocation ?? ch.salesOrder?.shippingAddress ?? ch.customer?.addressLine1 ?? null,
        problem: `Installation - ${qty} item${qty === 1 ? '' : 's'}`,
        status: ch.status, statusLabel: ch.status === 'work_done' ? 'Work done - to bill' : stageLabel(ch.stage), priority: ch.priority,
        givenAt: ch.dispatchedAt, visits: ch.visits, customerPhone: ch.customer?.phone ?? ch.salesOrder?.phone ?? null,
        lat: ch.siteLat ? Number(ch.siteLat) : null, lng: ch.siteLng ? Number(ch.siteLng) : null,
      }, now);
      const ids = ch.assignees.map((a) => a.userId);
      const group: OfficeGroup = ch.status === 'work_done' ? 'waiting'
        : ids.length === 0 ? 'unassigned'
          : ['fitting', 'installing', 'testing', 'handover'].includes(ch.stage) ? 'working' : 'todo';
      return {
        ...row, group, createdAt: ch.createdAt.toISOString(),
        technicianIds: ids, technicianNames: ids.map((id) => nameOf.get(id) ?? 'Technician'),
      };
    }),
  ];

  // Late first, then soonest visit, then urgent (lib/my-work) - the order the owner reads in.
  const order = new Map(sortWork(jobs).map((j, i) => [`${j.kind}:${j.id}`, i]));
  jobs.sort((a, b) => order.get(`${a.kind}:${a.id}`)! - order.get(`${b.kind}:${b.id}`)!);

  return {
    jobs,
    technicians: people.map((p) => ({ id: p.id, name: p.fullName })),
    now: now.toISOString(),
  };
}
