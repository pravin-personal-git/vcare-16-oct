import 'server-only';
import { db } from '../db';
import { scopeWhere, type StoreScope } from '../store-scope';
import type { ScorecardSettings } from '@/lib/scorecard/settings';
import { activeMs, buildSegments, median, statusIntervals, type Interval, type Segment } from '@/lib/scorecard/segments';
import { istDay } from '@/lib/scorecard/period';
import {
  addEvidence, assignmentHistory, clearKey, complaintsReassignedIn, groupBy, newOut, pct, reliability, setVal, type EngineOut,
} from './common';

/**
 * TECHNICIAN SCORECARD NUMBERS (31 Oct 2026). Spec: "Technician metrics" and
 * "Job ownership and fair credit". Every job is split by holder; each
 * technician is measured on their own segments with waits taken out.
 */

const WAIT_STATUSES = ['awaiting_estimate', 'awaiting_customer'] as const;
const DONE = ['resolved', 'closed'];
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export async function fieldEngine(
  scope: StoreScope, storeIds: string[], userIds: string[], from: Date, to: Date,
  s: ScorecardSettings, cleared: Set<string>,
): Promise<EngineOut> {
  const out = newOut();
  if (!userIds.length) return out;
  const people = new Set(userIds);
  const now = Math.min(Date.now(), to.getTime());
  const inPeriod = (t: number | null | undefined) => t !== null && t !== undefined && t >= from.getTime() && t < to.getTime();

  const range = { gte: from, lt: to };
  // Started together: none of these needs the jobs, and the database is a round trip away.
  const fittedP = db.installationChallanAssignee.findMany({
    where: { userId: { in: userIds }, deletedAt: null, challan: { ...scopeWhere(scope), deletedAt: null, handoverAt: range } },
    select: { userId: true, challan: { select: { id: true, challanNo: true, handoverAt: true } } },
  });
  const visitsP = db.serviceVisit.findMany({
    where: { technicianId: { in: userIds }, deletedAt: null, OR: [{ scheduledAt: range }, { completedAt: range }] },
    select: { id: true, complaintId: true, technicianId: true, scheduledAt: true, checkedInAt: true, checkInWithinRange: true, completedAt: true, outcomeNote: true, status: true },
  });
  const phoneP = Promise.all([
    db.attendanceSession.findMany({
      where: { userId: { in: userIds }, deletedAt: null, startedAt: { lt: to }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
      select: { id: true, userId: true, startedAt: true, endedAt: true },
    }),
    db.attendanceEvent.findMany({
      where: { userId: { in: userIds }, recordedAt: range, deletedAt: null },
      select: { userId: true, sessionId: true, recordedAt: true, mocked: true },
      orderBy: { recordedAt: 'asc' },
    }),
    db.deviceEvent.findMany({ where: { userId: { in: userIds }, kind: 'mock_location', createdAt: range }, select: { userId: true } }),
    db.deviceHealthDay.findMany({ where: { userId: { in: userIds }, day: { gte: istDay(from), lt: istDay(to.getTime() + DAY) } }, select: { userId: true, flags: true } }),
  ]);
  const reliabilityP = reliability(scope, userIds, from, to, out);

  // ---- the jobs: assigned, accepted or closed in the period, or handed over in it
  const handedOver = await complaintsReassignedIn(storeIds, from, to);
  const jobs = await db.complaint.findMany({
    where: {
      ...scopeWhere(scope), deletedAt: null,
      OR: [{ assignedAt: range }, { acceptedAt: range }, { resolvedAt: range }, ...(handedOver.length ? [{ id: { in: handedOver } }] : [])],
    },
    select: {
      id: true, complaintNo: true, status: true, legacyRef: true, createdAt: true, assignedAt: true, acceptedAt: true,
      resolvedAt: true, closedAt: true, updatedAt: true, assignedTechnicianId: true, signOff: true, needsCallback: true,
      ratingStars: true, techRatingStars: true,
    },
  });
  const ids = jobs.map((j) => j.id);
  const [history, activities, reassigns, challans, overrides, leave, attachments] = await Promise.all([
    assignmentHistory(ids),
    ids.length ? db.complaintActivity.findMany({
      where: { complaintId: { in: ids }, deletedAt: null },
      select: { complaintId: true, kind: true, statusFrom: true, statusTo: true, createdBy: true, createdAt: true, body: true },
      orderBy: { createdAt: 'asc' },
    }) : [],
    ids.length ? db.jobReassign.findMany({ where: { complaintId: { in: ids } }, select: { complaintId: true, toUserId: true, reason: true, createdAt: true } }) : [],
    ids.length ? db.jobChallan.findMany({
      where: { complaintId: { in: ids }, deletedAt: null },
      select: { complaintId: true, createdAt: true, createdBy: true, status: true, updatedAt: true, issues: { select: { issuedAt: true } } },
    }) : [],
    ids.length ? db.siteOverride.findMany({ where: { complaintId: { in: ids }, deletedAt: null }, select: { complaintId: true, createdAt: true, decidedAt: true } }) : [],
    db.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: 'approved', deletedAt: null, fromDate: { lte: to }, toDate: { gte: new Date(from.getTime() - 90 * DAY) } },
      select: { userId: true, fromDate: true, toDate: true },
    }),
    ids.length ? db.documentAttachment.findMany({
      where: { docType: 'complaint', docId: { in: ids }, deletedAt: null, uploadedBy: { in: userIds } },
      select: { docId: true, uploadedBy: true },
    }) : [],
  ]);
  const actsBy = groupBy(activities, (a) => a.complaintId);
  const reassignBy = groupBy(reassigns, (r) => r.complaintId);
  const challansBy = groupBy(challans, (c) => c.complaintId ?? '');
  const overridesBy = groupBy(overrides, (o) => o.complaintId);
  const leaveBy = groupBy(leave, (l) => l.userId);
  const photoKeys = new Set(attachments.map((a) => `${a.docId}|${a.uploadedBy}`));

  // ---- per person tallies
  const acceptMin = new Map<string, number[]>(), reachMin = new Map<string, number[]>(), activeH = new Map<string, number[]>();
  const closed = new Map<string, number>(), closedJobs = new Map<string, { id: string; no: string; signOff: string | null; stars: number | null; callback: boolean; photo: boolean }[]>();
  const reopened = new Map<string, number>(), taken = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const push = (m: Map<string, number[]>, k: string, v: number) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

  for (const j of jobs) {
    const acts = actsBy.get(j.id) ?? [];
    const hist = history.get(j.id) ?? [];
    const end = Math.min(now, (j.resolvedAt ?? j.closedAt ?? (j.status === 'cancelled' ? j.updatedAt : null))?.getTime() ?? now);
    const start = hist.length ? j.createdAt.getTime() : (j.assignedAt ?? j.createdAt).getTime();
    const reasons = reassignBy.get(j.id) ?? [];
    const reasonFor = (at: number, toId: string | null) =>
      reasons.find((r) => r.toUserId === toId && Math.abs(r.createdAt.getTime() - at) < 2 * MIN)?.reason ?? null;
    const segments: Segment[] = buildSegments({
      start, end,
      first: hist.length ? hist[0]!.from : j.assignedTechnicianId,
      changes: hist.map((h) => ({ at: h.at, to: h.to, reason: reasonFor(h.at, h.to) })),
    });

    // Waits nobody holding the job controls.
    const jobPauses: Interval[] = [
      ...statusIntervals(acts.filter((a) => a.statusTo).map((a) => ({ at: a.createdAt.getTime(), to: a.statusTo })), WAIT_STATUSES, end),
      ...(challansBy.get(j.id) ?? []).map((c) => ({
        start: c.createdAt.getTime(),
        end: c.issues[0]?.issuedAt.getTime() ?? (['withdrawn', 'rejected'].includes(c.status) ? c.updatedAt.getTime() : end),
      })),
      ...(overridesBy.get(j.id) ?? []).map((o) => ({ start: o.createdAt.getTime(), end: o.decidedAt?.getTime() ?? end })),
    ];
    const legacy = !!j.legacyRef;

    for (const seg of segments) {
      if (!people.has(seg.userId)) continue;
      const pauses = [...jobPauses, ...(leaveBy.get(seg.userId) ?? []).map((l) => ({ start: l.fromDate.getTime(), end: l.toDate.getTime() + DAY }))];
      const inSeg = (t: number) => t >= seg.start && t <= seg.end;
      const accept = acts.find((a) => a.statusTo === 'accepted' && inSeg(a.createdAt.getTime()));
      const acceptAt = accept?.createdAt.getTime() ?? (j.acceptedAt && inSeg(j.acceptedAt.getTime()) ? j.acceptedAt.getTime() : null);
      if (!legacy && acceptAt !== null && inPeriod(acceptAt)) push(acceptMin, seg.userId, activeMs(seg.start, acceptAt, pauses) / MIN);
      const onSite = acts.find((a) => a.statusTo === 'on_site' && inSeg(a.createdAt.getTime()) && (acceptAt === null || a.createdAt.getTime() >= acceptAt));
      if (!legacy && acceptAt !== null && onSite && inPeriod(onSite.createdAt.getTime())) push(reachMin, seg.userId, activeMs(acceptAt, onSite.createdAt.getTime(), pauses) / MIN);

      const closedHere = !!j.resolvedAt && j.resolvedAt.getTime() <= seg.end + MIN && seg.reasonOut === null && seg === segments.at(-1);
      if (closedHere && inPeriod(j.resolvedAt!.getTime())) {
        bump(closed, seg.userId);
        if (!legacy) push(activeH, seg.userId, activeMs(seg.start, seg.end, pauses) / HOUR);
        const list = closedJobs.get(seg.userId) ?? [];
        list.push({ id: j.id, no: j.complaintNo, signOff: j.signOff, stars: j.techRatingStars ?? j.ratingStars, callback: j.needsCallback, photo: photoKeys.has(`${j.id}|${seg.userId}`) });
        closedJobs.set(seg.userId, list);
        addEvidence(out, seg.userId, { metric: 'f_closed', ruleKey: null, refId: j.id, refNo: j.complaintNo, href: `/services/complaints/${j.id}`, at: j.resolvedAt!, text: 'Closed', weight: 0 });
      } else if (seg.reasonOut !== null && inPeriod(seg.end)) {
        // Handed over: half credit for real work in the segment; "did not act" is a miss.
        const worked = acts.some((a) => a.createdBy === seg.userId && inSeg(a.createdAt.getTime()) && (a.kind === 'remark' || a.statusTo === 'on_site' || a.kind === 'challan_changed'));
        if (worked && j.resolvedAt && inPeriod(j.resolvedAt.getTime())) {
          bump(closed, seg.userId, s.limits.contributedCredit);
          addEvidence(out, seg.userId, { metric: 'f_closed', ruleKey: null, refId: j.id, refNo: j.complaintNo, href: `/services/complaints/${j.id}`, at: j.resolvedAt, text: 'Helped close before a handover (half credit)', weight: 0 });
        }
        if (seg.reasonOut === 'did_not_act' && !cleared.has(clearKey(seg.userId, 'f_taken', j.id))) {
          bump(taken, seg.userId);
          addEvidence(out, seg.userId, { metric: 'f_taken', ruleKey: 'f_taken', refId: j.id, refNo: j.complaintNo, href: `/services/complaints/${j.id}`, at: new Date(seg.end), text: 'Reassigned: technician did not act', weight: 1 });
        }
      }
    }

    // Reopened after this technician closed it: the holder at the earlier close.
    for (const a of acts) {
      if (!a.statusFrom || !DONE.includes(a.statusFrom) || !a.statusTo || DONE.includes(a.statusTo) || a.statusTo === 'cancelled') continue;
      const at = a.createdAt.getTime();
      if (!inPeriod(at)) continue;
      const closeAct = [...acts].reverse().find((x) => x.createdAt.getTime() < at && x.statusTo && DONE.includes(x.statusTo));
      if (!closeAct || at - closeAct.createdAt.getTime() > s.limits.reopenDays * DAY) continue;
      const holder = segments.find((g) => closeAct.createdAt.getTime() >= g.start && closeAct.createdAt.getTime() <= g.end + MIN)?.userId;
      if (!holder || !people.has(holder) || cleared.has(clearKey(holder, 'f_reopen', a.createdAt.toISOString() + j.id))) continue;
      bump(reopened, holder);
      addEvidence(out, holder, { metric: 'f_reopen', ruleKey: 'f_reopen', refId: a.createdAt.toISOString() + j.id, refNo: j.complaintNo, href: `/services/complaints/${j.id}`, at: a.createdAt, text: a.createdBy ? 'Reopened after closing' : 'Reopened by the customer', weight: 1 });
    }
  }

  // Installations handed over in the period, credited to everyone on the team.
  const fitted = await fittedP;
  for (const f of fitted) {
    bump(closed, f.userId);
    addEvidence(out, f.userId, { metric: 'f_closed', ruleKey: null, refId: f.challan.id, refNo: f.challan.challanNo, href: `/services/installations/${f.challan.id}`, at: f.challan.handoverAt!, text: 'Installation handed over', weight: 0 });
  }

  // ---- visits: on time, at the site, with a remark
  const visits = await visitsP;
  const remarkActs = activities.filter((a) => a.kind === 'remark');
  const visitsBy = groupBy(visits, (v) => v.technicianId);

  // ---- phone: gaps, fake points, daily health
  const [sessions, events, mockEvents, health] = await phoneP;
  const eventsBySession = groupBy(events, (e) => e.sessionId ?? '');
  const sessionsBy = groupBy(sessions, (x) => x.userId);
  const gapLimit = s.limits.gapMinutes * MIN;

  for (const id of userIds) {
    setVal(out, 'f_accept', id, median(acceptMin.get(id) ?? []), acceptMin.get(id)?.length ?? 0);
    setVal(out, 'f_reach', id, median(reachMin.get(id) ?? []), reachMin.get(id)?.length ?? 0);
    setVal(out, 'f_active_close', id, median(activeH.get(id) ?? []), activeH.get(id)?.length ?? 0);
    const done = closedJobs.get(id) ?? [];
    setVal(out, 'f_closed', id, closed.get(id) ?? 0, 99);
    setVal(out, 'f_reopen', id, done.length ? ((reopened.get(id) ?? 0) / done.length) * 100 : null, done.length);
    setVal(out, 'f_taken', id, taken.get(id) ?? 0, 99);
    setVal(out, 'f_signoff', id, pct(done.filter((d) => d.signOff === 'customer').length, done.length), done.length);
    setVal(out, 'f_photo', id, pct(done.filter((d) => d.photo).length, done.length), done.length);
    const rated = done.filter((d) => d.stars !== null);
    setVal(out, 'f_rating', id, rated.length ? rated.reduce((a, d) => a + d.stars!, 0) / rated.length : null, rated.length);
    setVal(out, 'f_callback', id, pct(done.filter((d) => d.callback).length, done.length), done.length);

    const mine = visitsBy.get(id) ?? [];
    const checked = mine.filter((v) => v.checkedInAt && inPeriod(v.scheduledAt.getTime()));
    setVal(out, 'f_visit_on_time', id, pct(checked.filter((v) => v.checkedInAt!.getTime() - v.scheduledAt.getTime() <= s.limits.visitLateMinutes * MIN).length, checked.length), checked.length);
    const ranged = checked.filter((v) => v.checkInWithinRange !== null);
    setVal(out, 'f_checkin', id, pct(ranged.filter((v) => v.checkInWithinRange).length, ranged.length), ranged.length);
    const completed = mine.filter((v) => v.completedAt && inPeriod(v.completedAt.getTime()));
    let withRemark = 0, useful = 0;
    for (const v of completed) {
      const day = istDay(v.completedAt!);
      const words = [v.outcomeNote ?? '', ...remarkActs.filter((a) => a.complaintId === v.complaintId && a.createdBy === id && istDay(a.createdAt) === day).map((a) => a.body ?? '')].join(' ').trim();
      if (!words) {
        addEvidence(out, id, { metric: 'f_remark', ruleKey: null, refId: v.id, refNo: 'Visit', href: v.complaintId ? `/services/complaints/${v.complaintId}` : '/services/board', at: v.completedAt!, text: 'Visit completed with no remark', weight: 0 });
        continue;
      }
      withRemark += 1;
      if (words.split(/\s+/).filter(Boolean).length >= s.limits.usefulRemarkWords) useful += 1;
    }
    setVal(out, 'f_remark', id, pct(withRemark, completed.length), completed.length);
    setVal(out, 'f_remark_useful', id, pct(useful, withRemark), withRemark);

    // Phone: minutes beyond the gap limit with no location, per 8 hours on shift.
    let gapMs = 0, shiftMs = 0;
    const mySessions = sessionsBy.get(id) ?? [];
    for (const x of mySessions) {
      const a = Math.max(x.startedAt.getTime(), from.getTime()), b = Math.min(x.endedAt?.getTime() ?? now, now);
      if (b <= a) continue;
      shiftMs += b - a;
      const times = [a, ...(eventsBySession.get(x.id) ?? []).map((e) => e.recordedAt.getTime()).filter((t) => t > a && t < b), b];
      for (let i = 1; i < times.length; i += 1) { const g = times.at(i)! - times.at(i - 1)!; if (g > gapLimit) gapMs += g - gapLimit; }
    }
    const tracked = events.some((e) => e.userId === id);
    setVal(out, 'f_gap', id, tracked && shiftMs > 0 ? (gapMs / shiftMs) * 8 * 60 : null, tracked ? mySessions.length : 0);
    setVal(out, 'f_fake', id, tracked ? events.filter((e) => e.userId === id && e.mocked).length + mockEvents.filter((e) => e.userId === id).length : null, tracked ? mySessions.length : 0);
    const days = health.filter((h) => h.userId === id);
    setVal(out, 'f_health', id, pct(days.filter((d) => d.flags.length === 0).length, days.length), days.length);
  }

  await reliabilityP;
  return out;
}
