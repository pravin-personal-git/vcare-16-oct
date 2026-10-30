import type { MetricDef } from './score';
import type { Template } from './settings';

/**
 * Every number on a scorecard, by template (31 Oct 2026). `source` is the
 * Atlas table and field it is read from - shown under each metric, so nobody
 * has to take a number on trust. Spec sections "Technician metrics",
 * "Office metrics" and "Attendance and phone discipline".
 */

const COUNT = 99; // a count has no sample size: always enough data, ranked if there are peers

export const RELIABILITY: MetricDef[] = [
  { key: 'r_present', pillar: 'reliability', label: 'Present on working days', better: 'higher', unit: 'pct', hint: 'Days with a punch out of working days (holidays, week offs, leave left out)', source: 'AttendanceDay via the monthly summary' },
  { key: 'r_late', pillar: 'reliability', label: 'Late arrivals per 20 days', better: 'lower', unit: 'count', hint: 'First in after shift start plus grace', source: 'Monthly summary (attendance-policy shift and grace)' },
];

export const FIELD_METRICS: MetricDef[] = [
  { key: 'f_accept', pillar: 'response', label: 'Time to accept a job', better: 'lower', unit: 'min', hint: 'From the job reaching this technician to Accept, leave left out; each handover counts for its own holder', source: 'ComplaintActivity (accepted) + holder segments from AuditEvent' },
  { key: 'f_reach', pillar: 'response', label: 'Time to reach the site', better: 'lower', unit: 'min', hint: 'Accept to Working on site, waits left out', source: 'ComplaintActivity (on_site)' },
  { key: 'f_visit_on_time', pillar: 'response', label: 'Visits started on time', better: 'higher', unit: 'pct', hint: 'Checked in within the late limit of the booked time', source: 'ServiceVisit.checkedInAt vs scheduledAt' },
  { key: 'f_gap', pillar: 'phone', label: 'Minutes without location per 8 h shift', better: 'lower', unit: 'min', hint: 'Gaps longer than the limit with no location while clocked in', source: 'AttendanceEvent.recordedAt within AttendanceSession' },
  { key: 'f_fake', pillar: 'phone', label: 'Fake-location readings', better: 'lower', unit: 'count', hint: 'Points the phone itself marked as mocked', source: 'AttendanceEvent.mocked, DeviceEvent mock_location' },
  { key: 'f_health', pillar: 'phone', label: 'Days the phone was set up right', better: 'higher', unit: 'pct', hint: 'No location off, missing permission, battery restriction or clock change that day', source: 'DeviceHealthDay (recorded from 31 Oct 2026)' },
  { key: 'f_checkin', pillar: 'phone', label: 'Check-ins at the site', better: 'higher', unit: 'pct', hint: 'Visit check-in within range of the site pin', source: 'ServiceVisit.checkInWithinRange' },
  { key: 'f_remark', pillar: 'remarks', label: 'Visits with a remark', better: 'higher', unit: 'pct', hint: 'Completed visits with an outcome note or a remark by the technician that day', source: 'ServiceVisit.outcomeNote, ComplaintActivity (remark)' },
  { key: 'f_remark_useful', pillar: 'remarks', label: 'Remarks long enough to be useful', better: 'higher', unit: 'pct', hint: 'Remarks with at least the minimum words', source: 'same' },
  { key: 'f_photo', pillar: 'remarks', label: 'Closed jobs with a site photo', better: 'higher', unit: 'pct', hint: 'A photo uploaded by the technician on the job', source: 'DocumentAttachment (complaint, uploadedBy)' },
  { key: 'f_closed', pillar: 'delivery', label: 'Jobs closed', better: 'higher', unit: 'count', minN: 1, hint: 'Closed = 1, helped close (visit, challan or remark before a handover) = half; installations handed over = 1', source: 'Complaint.resolvedAt + holder segments; InstallationChallan.handoverAt' },
  { key: 'f_active_close', pillar: 'delivery', label: 'Active hours to close', better: 'lower', unit: 'hours', hint: 'Own holding time on jobs closed, waits for parts, customer, estimate, approval and leave left out', source: 'Holder segments minus pauses' },
  { key: 'f_reopen', pillar: 'delivery', label: 'Closed jobs reopened, per 100', better: 'lower', unit: 'rate', hint: 'Reopened within the limit after this technician closed it', source: 'ComplaintActivity (status back from resolved/closed)' },
  { key: 'f_taken', pillar: 'delivery', label: 'Jobs taken away for not acting', better: 'lower', unit: 'count', minN: 1, hint: 'Reassigned with the reason "Technician did not act"', source: 'JobReassign.reason' },
  { key: 'f_signoff', pillar: 'delivery', label: 'Closed with the customer\'s code', better: 'higher', unit: 'pct', hint: 'Signed off by the customer, not by the office', source: 'Complaint.signOff' },
  { key: 'f_rating', pillar: 'customer', label: 'Customer rating', better: 'higher', unit: 'stars', minN: 3, hint: 'Average stars on jobs this technician closed', source: 'Complaint.techRatingStars / ratingStars' },
  { key: 'f_callback', pillar: 'customer', label: 'Customers asking for a call back', better: 'lower', unit: 'pct', hint: 'Share of closed jobs where the customer asked to be called', source: 'Complaint.needsCallback' },
  ...RELIABILITY,
];

export const OFFICE_METRICS: MetricDef[] = [
  { key: 'o_hygiene', pillar: 'hygiene', label: 'Misses per 100 documents', better: 'lower', unit: 'rate', minN: 1, hint: 'Mistakes count 2, SOP misses 1, per 100 jobs, approvals and invoices this person handled', source: 'AuditEvent and the hygiene rules in Settings > Scorecards' },
  { key: 'o_assign', pillar: 'speed', label: 'Raise to assign', better: 'lower', unit: 'min', hint: 'Working minutes (9 am to 7 pm, Mon-Sat) from raising to the first assignment, credited to who assigned', source: 'ComplaintActivity (assignment).createdBy' },
  { key: 'o_approval', pillar: 'speed', label: 'Approval decision time', better: 'lower', unit: 'hours', hint: 'Working hours from the request to this person\'s decision', source: 'ApprovalRequest.decidedBy / decidedAt' },
  { key: 'o_challan', pillar: 'speed', label: 'Challan approval time', better: 'lower', unit: 'min', hint: 'Working minutes from a challan raised to approved', source: 'JobChallan.approvedBy / approvedAt' },
  { key: 'o_override', pillar: 'speed', label: 'Site override decision time', better: 'lower', unit: 'min', hint: 'Working minutes from the technician\'s ask to the decision', source: 'SiteOverride.decidedBy / decidedAt' },
  { key: 'o_raised', pillar: 'throughput', label: 'Jobs raised', better: 'higher', unit: 'count', minN: 1, hint: 'Complaints and installations created', source: 'Complaint.createdBy, InstallationChallan.createdBy' },
  { key: 'o_decisions', pillar: 'throughput', label: 'Decisions made', better: 'higher', unit: 'count', minN: 1, hint: 'Approvals, challans and site overrides decided', source: 'ApprovalRequest, JobChallan, SiteOverride' },
  { key: 'o_tasks', pillar: 'throughput', label: 'Tasks completed', better: 'higher', unit: 'count', minN: 1, hint: 'Tasks assigned to this person and done', source: 'Task.assignedToId / completedAt' },
  { key: 'o_billed', pillar: 'throughput', label: 'Invoices made', better: 'higher', unit: 'count', minN: 1, hint: 'Invoices created and not cancelled', source: 'Invoice.createdBy' },
  { key: 'o_calls', pillar: 'followup', label: 'Calls answered or made', better: 'higher', unit: 'count', minN: 1, hint: 'Connected calls in and out from the paired phone', source: 'CallLog (durationSec > 0)' },
  { key: 'o_callback', pillar: 'followup', label: 'Call backs kept', better: 'higher', unit: 'pct', hint: 'Customers who asked to be called and were called within the limit', source: 'Complaint.needsCallback + CallLog to their number' },
  ...RELIABILITY,
];

export const METRICS: Record<Template, MetricDef[]> = { field: FIELD_METRICS, office: OFFICE_METRICS };
export { COUNT };

/** Not recorded by Atlas - shown on every scorecard so nobody reads a blank as zero. */
export const NOT_MEASURED: Record<Template, string[]> = {
  field: [
    'Money collected on site: receipts do not record who took the payment.',
    'Why parts came back: returns are counted, not the reason.',
    'Phone set-up before 31 Oct 2026: only the latest state was kept until then.',
  ],
  office: [
    'Time spent on WhatsApp chats: not recorded.',
    'Calls from a phone without the Vcare call sync.',
    'Why a document was corrected, before reasons were asked: judged by the rules only.',
  ],
};
