import 'server-only';
import { db } from './db';
import { notify, ownersOf, sendCustomerMessage } from './notify';
import { getJobSettings } from './job-settings';
import { slaChecks, SLA_LABEL, SLA_START } from '@/lib/job-sla';
import { FEED_MAX_ROWS } from '@/lib/list-limits';

/**
 * Who hears about what on a field job (workflow slice 7, spec §7). One place
 * so a new step cannot forget to tell someone, and nobody is told twice.
 *
 *   technician -> push/bell (kind 'job')
 *   office     -> the owners (settings.edit) and the job's owner, bell/push
 *   store      -> people with stock rights, for parts to issue
 *   customer   -> email when an address exists (SMS/WhatsApp plug in later
 *                 through sendCustomerMessage; the office can also send the
 *                 job link on WhatsApp)
 *
 * Never throws - a failed notification must not undo the job step.
 */
export type JobEvent =
  | 'assigned' | 'accepted' | 'declined' | 'visit_booked' | 'visit_changed' | 'on_the_way'
  | 'slot_asked' | 'override_decided' | 'challan_decided' | 'challan_to_issue' | 'challan_issued' | 'parts_returning' | 'old_unit_due' | 'gdn_auto' | 'gdn_changed'
  | 'estimate_sent' | 'estimate_decided' | 'customer_confirmed' | 'not_resolved' | 'reopened' | 'sent_back' | 'closed';

type Who = 'tech' | 'office' | 'store' | 'customer';

/** Which audiences each event reaches, and what they read. */
const PLAN: Record<JobEvent, { to: Who[]; title: (no: string, x: string) => string }> = {
  assigned: { to: ['tech'], title: (no) => `New job ${no} - please accept or decline` },
  accepted: { to: ['customer'], title: (no, x) => `${no}: ${x} will attend to your request` },
  declined: { to: ['office'], title: (no, x) => `${no} was declined - ${x}. Assign someone else.` },
  visit_booked: { to: ['tech', 'customer'], title: (no, x) => `${no}: visit booked for ${x}` },
  visit_changed: { to: ['tech', 'office', 'customer'], title: (no, x) => `${no}: visit moved - ${x}` },
  on_the_way: { to: ['customer'], title: (no) => `${no}: your technician is on the way` },
  slot_asked: { to: ['tech', 'office'], title: (no, x) => `${no}: customer asked for another time - ${x}` },
  override_decided: { to: ['tech'], title: (no, x) => `${no}: your location override was ${x}` },
  challan_decided: { to: ['tech'], title: (no, x) => `${no}: challan ${x}` },
  challan_to_issue: { to: ['store'], title: (no, x) => `Parts to issue for ${no}: ${x}` },
  challan_issued: { to: ['tech'], title: (no, x) => `${no}: parts ready - issued on ${x}` },
  // 28 Sep 2026: the store confirms returns and receives the replaced unit.
  parts_returning: { to: ['store'], title: (no, x) => `Unused parts coming back for ${no}: ${x} - receive them` },
  gdn_auto: { to: ['store'], title: (no, x) => `${no}: ${x} created automatically - hand the parts to the technician` },
  gdn_changed: { to: ['tech'], title: (no, x) => `${no}: the store changed the parts issue - ${x}` },
  old_unit_due: { to: ['store', 'tech'], title: (no, x) => `${no}: bring back the old unit - ${x}` },
  estimate_sent: { to: ['customer'], title: (no, x) => `${no}: please approve the estimate of ${x}` },
  estimate_decided: { to: ['tech', 'office'], title: (no, x) => `${no}: customer ${x} the estimate` },
  customer_confirmed: { to: ['tech'], title: (no) => `${no}: the customer confirmed it is resolved` },
  not_resolved: { to: ['tech', 'office'], title: (no, x) => `${no}: customer says it is NOT resolved - ${x}` },
  reopened: { to: ['tech', 'office'], title: (no, x) => `${no} was reopened by the customer - ${x}` },
  sent_back: { to: ['tech'], title: (no, x) => `${no} was sent back to you - ${x}` },
  closed: { to: ['tech'], title: (no) => `${no} is closed. Thank you.` },
};

export async function jobEvent(complaintId: string, event: JobEvent, detail = ''): Promise<void> {
  try {
    const c = await db.complaint.findUnique({
      where: { id: complaintId },
      select: {
        id: true, storeId: true, complaintNo: true, assignedTechnicianId: true, ownerId: true, customerToken: true,
        customer: { select: { email: true, firstName: true, companyName: true } },
      },
    });
    if (!c) return;
    const plan = PLAN[event];
    const title = plan.title(c.complaintNo, detail);
    const stamp = Date.now();
    const staff = new Set<string>();
    if (plan.to.includes('tech') && c.assignedTechnicianId) staff.add(c.assignedTechnicianId);
    if (plan.to.includes('office')) {
      for (const id of await ownersOf(c.storeId)) staff.add(id);
      if (c.ownerId) staff.add(c.ownerId);
    }
    if (plan.to.includes('store')) {
      const store = await db.user.findMany({
        where: { isActive: true, storeRoles: { some: { storeId: c.storeId, role: { permissions: { some: { permission: { key: 'stock.adjust' } } } } } } },
        select: { id: true }, take: FEED_MAX_ROWS,
      });
      for (const u of store) staff.add(u.id);
    }
    if (staff.size) {
      await notify({
        storeId: c.storeId, userIds: [...staff], kind: 'job', title, body: null,
        href: ['challan_to_issue', 'parts_returning', 'gdn_auto'].includes(event) ? '/goods-dispatch/job-parts' : `/services/complaints/${c.id}`,
        entityType: 'job', entityId: c.id, dedupeKey: `job:${event}:${c.id}:${stamp}`,
      });
    }
    if (plan.to.includes('customer')) {
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';
      await sendCustomerMessage(
        { email: c.customer.email, name: c.customer.companyName || c.customer.firstName || '' },
        title, title, c.customerToken ? `${APP_URL}/j/${c.customerToken}` : undefined,
      );
    }
  } catch (e) {
    console.error(`[job-notify] ${event} failed`, e);
  }
}

/**
 * The same events for an INSTALLATION's parts (22 Oct 2026, R2/R3): material
 * challans and unused goods coming back. Its technicians are the team on the
 * challan; the store and office are found as for a complaint. The customer is
 * never told about parts. Never throws.
 */
export async function installationEvent(installationChallanId: string, event: JobEvent, detail = ''): Promise<void> {
  try {
    const c = await db.installationChallan.findUnique({
      where: { id: installationChallanId },
      select: { id: true, storeId: true, challanNo: true, assignees: { select: { userId: true } } },
    });
    if (!c) return;
    const plan = PLAN[event];
    const staff = new Set<string>();
    if (plan.to.includes('tech')) for (const a of c.assignees) staff.add(a.userId);
    if (plan.to.includes('office')) for (const id of await ownersOf(c.storeId)) staff.add(id);
    if (plan.to.includes('store')) {
      const store = await db.user.findMany({
        where: { isActive: true, storeRoles: { some: { storeId: c.storeId, role: { permissions: { some: { permission: { key: 'stock.adjust' } } } } } } },
        select: { id: true }, take: FEED_MAX_ROWS,
      });
      for (const u of store) staff.add(u.id);
    }
    if (!staff.size) return;
    await notify({
      storeId: c.storeId, userIds: [...staff], kind: 'job', title: plan.title(c.challanNo, detail), body: null,
      href: ['challan_to_issue', 'parts_returning', 'gdn_auto'].includes(event) ? '/goods-dispatch/job-parts' : `/services/installations/${c.id}`,
      entityType: 'installation_challan', entityId: c.id, dedupeKey: `install:${event}:${c.id}:${Date.now()}`,
    });
  } catch (e) {
    console.error(`[job-notify] installation ${event} failed`, e);
  }
}

/**
 * Deadlines (spec §4.9): near -> remind the technician, missed -> alert the
 * office. Each once per job per deadline (dedupe). Runs with the reminder
 * sweep (page loads, throttled, and the 08:00 cron).
 */
export async function jobSlaSweep(storeId: string, now: Date = new Date()): Promise<number> {
  const settings = await getJobSettings(storeId);
  const jobs = await db.complaint.findMany({
    where: { storeId, status: { notIn: ['resolved', 'closed', 'cancelled', 'awaiting_customer', 'awaiting_estimate'] }, createdAt: { gte: SLA_START }, legacyRef: null },
    select: {
      id: true, complaintNo: true, status: true, priority: true, createdAt: true, assignedAt: true, assignedTechnicianId: true, ownerId: true,
      onSiteSince: true, timeOnSiteSec: true, visits: { where: { checkedInAt: { not: null } }, select: { id: true }, take: 1 },
    },
    take: FEED_MAX_ROWS,
  });
  const owners = await ownersOf(storeId);
  let sent = 0;
  for (const j of jobs) {
    const checks = slaChecks({
      status: j.status, priority: j.priority, createdAt: j.createdAt, assignedAt: j.assignedAt,
      arrived: !!j.onSiteSince || j.timeOnSiteSec > 0 || j.visits.length > 0,
    }, settings.sla, now);
    for (const ch of checks) {
      const due = ch.due.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      if (ch.state === 'near' && j.assignedTechnicianId) {
        sent += await notify({
          storeId, userIds: [j.assignedTechnicianId], kind: 'job', title: `${j.complaintNo}: ${SLA_LABEL[ch.kind]} by ${due}`,
          body: 'The deadline is close.', href: `/services/complaints/${j.id}`, entityType: 'job', entityId: j.id,
          dedupeKey: `job-sla-near:${ch.kind}:${j.id}`,
        });
      }
      if (ch.state === 'missed') {
        const to = [...new Set([...owners, ...(j.ownerId ? [j.ownerId] : [])])];
        sent += await notify({
          storeId, userIds: to, kind: 'escalation', title: `${j.complaintNo} missed its deadline to ${SLA_LABEL[ch.kind]} (${due})`,
          body: null, href: `/services/complaints/${j.id}`, entityType: 'job', entityId: j.id,
          dedupeKey: `job-sla-missed:${ch.kind}:${j.id}`,
        });
      }
    }
  }
  return sent;
}
