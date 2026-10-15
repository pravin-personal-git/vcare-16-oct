import { rememberBrand } from './brand';
import { authed } from './api';
import { send } from './outbox';
import type { ScanResult } from '@shared/lib/scan/extraction';
import { CUSTOMER_LABEL, OFFICE_LABEL } from '@shared/lib/job-flow';

/**
 * Typed calls for the job screens (technician, store, sales) and the
 * customer screens. Every call returns null when the session has ended.
 */

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

// ------------------------------------------------------------- technician

export interface ComplaintRow {
  id: string; complaintNo: string; customerName: string; customerPhone: string;
  /** Set instead of showing the number when the owner hides phone numbers (dial only). */
  customerPhoneDial?: string;
  siteLocation: string | null; siteLat: number | null; siteLng: number | null;
  productName: string | null; description: string; status: string; priority: string;
  assignedTechnicianId: string | null; assignedTechnicianName: string | null; createdAt: string;
  /** complaint | repair | installation (servers from 28 Sep 2026). */
  jobType?: string; closedAt?: string | null;
}
export interface VisitRow {
  /** complaintId is null for an installation's visit (servers from 11 Oct 2026). */
  id: string; complaintId: string; complaintNo: string; customerName: string; purpose: string;
  scheduledAt: string; status: string; checkedInAt: string | null;
  subject?: 'complaint' | 'installation'; installationChallanId?: string | null; docNo?: string;
}
export interface ComplaintDetail extends ComplaintRow {
  activities: { id: string; kind: string; body: string | null; statusTo: string | null; createdByName: string | null; createdAt: string }[];
  visits: {
    id: string; technicianName: string; purpose: string; scheduledAt: string; status: string; outcomeNote: string | null;
    completedAt: string | null; checkedInAt: string | null; checkInDistanceM: number | null; checkInWithinRange: boolean | null;
    changes?: { id: string; kind: string; fromAt: string; toAt: string | null; reason: string; changedByName: string | null }[];
  }[];
  declinedReason?: string | null;
}

/** The technician's next steps (workflow slice 3) - what the job screen offers. */
export type JobAction = 'accept' | 'decline' | 'on_the_way' | 'on_site' | 'leave_site' | 'work_done' | 'book_visit' | 'enter_otp' | 'resend_otp' | 'customer_approved';
/** Parts on a job (workflow slice 4) - challans with status and GDN, faulty parts. */
export interface JobParts {
  challans: { id: string; challanNo: string; type: string; status: string; rejectionReason: string | null; gdnNos: string[];
    lines: { id: string; productName: string; productCode: string; qty: number; qtyIssued: number; qtyReturned: number; qtyReturnPending?: number }[] }[];
  faulty: { id: string; description: string; serialNo: string | null; receivedAt: string | null }[];
  /**
   * Whether this business still lets a technician raise the challan
   * (Settings > Customisation on the website). Optional because a server
   * older than the setting does not send it - then the button shows, as it
   * always did, and the server has the final say either way.
   */
  canRaiseChallan?: boolean;
}
/**
 * One item on a job (repair flow stage 8, 10 Oct 2026): its serial, who pays
 * for the technician (AMC) and the part (warranty), and where it is in the
 * repair loop. Optional on JobState - an older server sends none.
 */
export interface JobItem {
  id: string; srNo: number; ours: boolean; equipmentName: string; serialNo: string | null; problem: string | null; status: string;
  labour: { free: boolean; reason: string }; parts: { free: boolean; reason: string };
  pickupNo: string | null; handbackGdnNo: string | null;
  repair: { status: string; outcome: string | null; newSerialNo: string | null } | null;
}
export interface JobState {
  parts?: JobParts;
  items?: JobItem[];
  /** The server's answer: this person may take items for repair on this job (its own switch). */
  canPickUp?: boolean;
  actions?: JobAction[];
  site?: { gate: boolean; radiusM: number; hasLocation: boolean };
  overridePending?: boolean;
  onSiteSince?: string | null;
  timeOnSiteSec?: number;
  overrideUsed?: boolean;
  /** Why there is no next step for this person (not theirs, switched off…) - shown instead of nothing. */
  noStepReason?: string | null;
}
export interface OnSiteResult { ok: boolean; reason?: 'no_site' | 'poor_accuracy' | 'too_far' | 'mocked'; distanceM?: number | null; message?: string; radiusM?: number }

export const myComplaints = (all = false) =>
  authed<{ complaints: ComplaintRow[]; visits: VisitRow[]; canEdit: boolean; done?: ComplaintRow[] }>(`/api/v1/jobs/complaints${all ? '?all=1' : ''}`);
export const complaintDetail = (id: string) =>
  authed<{ complaint: ComplaintDetail; calls?: CustomerCall[]; canEdit: boolean; me: string } & JobState>(`/api/v1/jobs/complaints/${id}`);
/** A call with the complaint's customer, from the call log (27 Sep 2026). */
export interface CustomerCall { id: string; userName: string; direction: string; startedAt: string; durationSec: number }
export const complaintAction = (id: string, body: Record<string, unknown>) =>
  authed<{ ok: boolean; complaint: ComplaintDetail; checkIn?: { withinRange: boolean; distanceMeters: number; radiusMeters: number }; onSite?: OnSiteResult }>(
    `/api/v1/jobs/complaints/${id}`, json(body),
  );

// ------------------------------------------------------------------ sales

export interface LeadRow {
  id: string; leadCode: string; businessName: string | null; displayName: string; mobile: string;
  city: string | null; stageName: string | null; requirement: string | null;
  lastTalkAt: string | null; nextActionAt: string | null; assignedToName: string | null;
}
export interface LeadDetail {
  id: string; leadCode: string; displayName: string; businessName: string | null; mobile: string; email: string | null;
  location: string; stageName: string | null; requirement: string | null; nextActionAt: string | null; lastTalkAt: string | null;
  notes: { id: string; body: string; createdAt: string; author: string | null }[];
  activities: { id: string; channel: string; outcome: string | null; note: string | null; occurredAt: string; author: string | null }[];
  editable: { mobileCc: string; mobile: string; mobileDial?: string };
}

export const myLeads = (all = false) => authed<{ leads: LeadRow[]; canCreate: boolean }>(`/api/v1/jobs/leads${all ? '?all=1' : ''}`);
export const leadDetail = (id: string) => authed<{ lead: LeadDetail }>(`/api/v1/jobs/leads/${id}`);
// Changes go through the offline outbox (F-13): sent now, or kept and sent when signal returns.
export const leadAction = (id: string, body: Record<string, unknown>) =>
  send<{ ok: true; lead: LeadDetail }>(`/api/v1/jobs/leads/${id}`, body, { label: 'Lead update', target: `lead:${id}` });
export const createLead = (body: Record<string, unknown>) =>
  send<{ ok: true; id: string | null }>('/api/v1/jobs/leads', body, { label: `New lead: ${String(body.firstName ?? '')}`.trim() });

// ------------------------------------------------------------------ store

export interface ProductHit { id: string; productCode: string; productName: string; barcode: string | null; trackingMode: string }
export interface UnitHit { id: string; serialNo: string | null; productName: string; productCode: string; status: string; condition: string; holderName: string | null; receivedAt: string; grnNo: string | null }
export interface Supplier { id: string; name: string; phone: string; gstin: string | null }
export interface GrnRow { id: string; grnNo: string; supplierName: string; receivedDate: string; status: string; supplierInvoiceNo: string | null; qty: number }

export const lookupCode = (code: string) =>
  authed<{ products: ProductHit[]; units: UnitHit[] }>(`/api/v1/stock/lookup?code=${encodeURIComponent(code)}`);
export const searchProducts = (q: string) =>
  authed<{ products: ProductHit[] }>(`/api/v1/stock/lookup?q=${encodeURIComponent(q)}`);
export const searchSuppliers = (q: string) =>
  authed<{ suppliers: Supplier[] }>(`/api/v1/stock/suppliers?q=${encodeURIComponent(q)}`);
export const listGrns = () => authed<{ grns: GrnRow[]; canReceive: boolean }>('/api/v1/stock/grn');
/** Scan-to-Stock G2 (12 Oct 2026): a product from a scanned barcode Atlas has never seen. */
export const productFormOptions = () =>
  authed<{ categories: { id: string; name: string; suggestedTracking: string }[] }>('/api/v1/stock/products');
export const createProductFromScan = (body: {
  productName: string; barcode: string | null; categoryId: string | null; trackingMode: string; sell: string; cost: string; taxRatePct: number;
}) => authed<{ ok: true; product: ProductHit }>('/api/v1/stock/products', json(body));
/** Scan-to-Stock G7: a photographed bill's lines matched to products on the server. */
export const matchBillLines = (lines: { description: string; barcode?: string | null }[]) =>
  authed<{ lines: { index: number; description: string; product: ProductHit | null }[] }>('/api/v1/stock/match-lines', json({ lines }));
export const receiveGoods = (body: Record<string, unknown>) =>
  authed<{ ok: true; id: string; grnNo: string; warnings: string[] }>('/api/v1/stock/grn', json(body));

// -------------------------------------------------------------------- AI

export type ScanKind = ScanResult['kind'];
export type { ScanResult };
export const readPhoto = (kind: ScanKind, imageBase64: string) =>
  authed<ScanResult>('/api/v1/scan/read', json({ kind, imageBase64, mediaType: 'image/jpeg' }));

// --------------------------------------------------------------- customer

export interface MyComplaint {
  id: string; complaintNo: string; productName: string | null; description: string; status: string;
  assignedTechnicianName: string | null; createdAt: string;
}
export const customerHome = () =>
  authed<{ summary: { openComplaints: number; totalPurchases: number; totalDuePaise: number }; recentComplaints: MyComplaint[]; business: { name: string; branch: string; brand?: { primary: string | null; navy: string | null } } }>('/api/v1/customer/home')
    // The business's colours ride along (UI refresh phase 5) - see lib/brand.
    .then((r) => { if (r) rememberBrand(r.business.brand); return r; });
export const customerComplaints = () =>
  authed<{ complaints: MyComplaint[]; products: { productId: string; productName: string }[] }>('/api/v1/customer/complaints');
export const customerComplaint = (id: string) =>
  authed<{ complaint: MyComplaint & { siteLocation: string | null; timeline: { id: string; kind: string; body: string | null; statusTo: string | null; createdAt: string }[]; visits: { id: string; purpose: string; scheduledAt: string; status: string; completedAt: string | null }[] }; job?: CustomerJob | null }>(`/api/v1/customer/complaints/${id}`);
/** What the customer can see and do on their job (workflow slice 5). */
export interface CustomerJob {
  status: string; statusLabel: string;
  technician: { name: string; phone: string | null } | null;
  estimate: { lines: { description: string; qty: number; unitPaise: number }[]; totalPaise: number; note: string | null } | null;
  /** The sign-off code to give the technician (slice 6). */
  otp?: string | null;
  rating: { stars: number; techStars?: number | null; comment: string | null } | null;
  /** Each item and where it is, in the customer's words (stage 8). Optional - an older server sends none. */
  items?: { name: string; serialNo: string | null; where: string; tone: 'open' | 'wait' | 'done'; doc: string | null }[];
  actions: string[];
}
export const customerJobAction = (id: string, body: Record<string, unknown>) =>
  authed<{ ok: true; job: CustomerJob | null }>(`/api/v1/customer/complaints/${id}`, json(body));
export const raiseComplaint = (body: Record<string, unknown>) =>
  authed<{ ok: true; id: string }>('/api/v1/customer/complaints', json(body));
export const customerInvoices = () =>
  authed<{ invoices: { id: string; invoiceNo: string; invoiceDate: string; grandTotalPaise: number; amountDuePaise: number; status: string; items: { productName: string; qty: number }[] }[] }>('/api/v1/customer/invoices');
export const changePassword = (current: string, next: string) =>
  authed<{ ok: true }>('/api/v1/customer/password', json({ current, next }));

// ---------------------------------------------------------------- labels

// Job words come from the website's rulebook (atlas-app lib/job-flow), so the
// phone and the website never disagree. Visit words are added on top.
export const STATUS_LABEL: Record<string, string> = {
  ...OFFICE_LABEL, completed: 'Completed', missed: 'Missed',
};
/** What a customer sees - milestones only. */
export const CUSTOMER_STATUS_LABEL: Record<string, string> = { ...CUSTOMER_LABEL, completed: 'Completed', missed: 'Missed' };
export const statusTone = (s: string): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' =>
  s === 'resolved' || s === 'completed' || s === 'closed' ? 'success'
    : s === 'cancelled' || s === 'missed' ? 'danger'
      : s === 'received' || s === 'assigned' ? 'warning'
        : s === 'awaiting_customer' || s === 'awaiting_estimate' ? 'neutral' : 'brand';

// ------------------------------------------------------------------ tasks

export interface TaskRow {
  id: string; title: string; description: string | null; status: string; priority: string;
  dueDate: string | null; assignedToId: string | null; assignedToName: string | null;
  createdByName: string | null; createdAt: string; completedAt: string | null; isOverdue: boolean;
}

export const myTasks = (all = false) =>
  authed<{ open: TaskRow[]; finished: TaskRow[]; canManage: boolean; me: string }>(`/api/v1/jobs/tasks${all ? '?all=1' : ''}`);
export const setTaskStatus = (id: string, status: string) =>
  send<{ ok: true }>(`/api/v1/jobs/tasks/${id}`, { status }, { label: `Task: ${status}`, target: `task:${id}` });

// ------------------------------------------------------------------ my desk (requests)

export type DeskKind = 'leave' | 'half_day' | 'wfh' | 'comp_off' | 'leave_allocation' | 'reimbursement' | 'leave_encashment' | 'asset_request' | 'resignation';
export interface DeskRequest {
  id: string; kind: DeskKind; label: string; detail: string; status: string;
  createdAt: string; decidedAt: string | null; decisionNote: string | null; waitingOn: string[];
}
export interface DeskOptions {
  leaveTypes: { id: string; name: string; balanceDays: number | null }[];
  compOffAvailable: number; categories: string[]; hasOpenResignation: boolean;
}
/** My own requests and the New request choices (the website's My Desk). */
export const myDesk = () => authed<{ requests: DeskRequest[]; options: DeskOptions }>('/api/v1/desk');
export const raiseRequest = (body: Record<string, unknown>) =>
  send<{ ok: true; message: string }>('/api/v1/desk', body, { label: `Request: ${String(body.kind ?? '')}` });

/** Waiting on me (5 Oct 2026): what this person can approve, from the same list as the website. */
export interface ApprovalItem {
  requestId: string | null; type: string; typeLabel: string; entityId: string; title: string; summary: string | null;
  amountPaise: number | null; requesterName: string; level: number; levels: number | null; since: string;
  waitingOnNames: string[]; raisedByMe: boolean; asOwner: boolean;
}
export const waitingApprovals = () => authed<{ items: ApprovalItem[]; isOwner: boolean }>('/api/v1/approvals');
export const decideApproval = (body: { type: string; entityId: string; decision: 'approved' | 'rejected'; note?: string | null }) =>
  send<{ ok: true; message: string }>('/api/v1/approvals', body, { label: `${body.decision === 'approved' ? 'Approved' : 'Rejected'}: ${body.type}`, target: `approval:${body.type}:${body.entityId}` });

/** Parts search for a challan - name and code only, open to technicians (workflow slice 4). */
export const searchJobProducts = (q: string) =>
  authed<{ products: { id: string; productCode: string; productName: string }[] }>(`/api/v1/jobs/products?q=${encodeURIComponent(q)}`);

// ------------------------------------------------- installations (2 Oct 2026)
//
// Their own list, not a filter on complaints. A complaint is something that
// broke; an installation challan is work that was sold, and sharing one list
// made a technician read past four repairs to find the fitting they were
// standing outside (Pravin's point 3).

export interface InstallationRow {
  id: string; challanNo: string; status: string; dispatchedAt: string;
  orderNo: string | null; customerName: string; siteAddress: string | null;
  itemCount: number; totalQty: number;
  /** Serial lines with nothing scanned against them yet. */
  unscanned: number;
  /** The website's working stage (servers from 11 Oct 2026; absent before). */
  stage?: string; stageLabel?: string;
}

export interface InstallationItem {
  id: string; productId: string | null; productName: string; productCode: string | null;
  qty: number; unit: string | null; barcode: string | null; serialNo: string | null;
  scannable: boolean; scanned: boolean;
  /** Where it goes on site, and to_fit | fitted | tested (servers from 11 Oct 2026). */
  placement?: string | null; fitStatus?: string;
}

export interface InstallationDetail {
  id: string; challanNo: string; status: string; dispatchedAt: string; isInvoiced: boolean;
  technicianRemark: string | null; note: string | null; physicalChallanNo: string | null;
  orderId: string | null; orderNo: string | null; customerName: string;
  phone: string | null; siteAddress: string | null; team: string[];
  items: InstallationItem[];
  /** Working stage (servers from 11 Oct 2026). `nextStage` is null when the next step is handover / approval. */
  stage?: string; stageLabel?: string; nextStage?: string | null; nextStageLabel?: string | null;
  stages?: { key: string; label: string }[]; priority?: string;
}

export const myInstallations = (all = false) =>
  authed<{ installations: InstallationRow[]; canEdit: boolean; scope: string }>(
    `/api/v1/jobs/installations${all ? '?all=1' : ''}`);

export const installation = (id: string) =>
  authed<{ installation: InstallationDetail; canEdit: boolean }>(`/api/v1/jobs/installations/${id}`);

export const scanOntoInstallation = (id: string, challanItemId: string, serialNo: string) =>
  send<{ ok: true }>(`/api/v1/jobs/installations/${id}`, { action: 'scan', challanItemId, serialNo }, { label: `Scanned ${serialNo}`, target: `installation:${id}` });

export const moveInstallationStage = (id: string, to: string) =>
  send<{ ok: true }>(`/api/v1/jobs/installations/${id}`, { action: 'stage', to }, { label: `Stage: ${to}`, target: `installation:${id}` });

export const updateInstallationItem = (id: string, challanItemId: string, change: { fitStatus?: string; placement?: string }) =>
  send<{ ok: true }>(`/api/v1/jobs/installations/${id}`, { action: 'item', challanItemId, ...change }, { label: change.fitStatus ? `Item ${change.fitStatus}` : 'Item placement', target: `installation:${id}` });

export const installationWorkDone = (id: string) =>
  send<{ ok: true }>(`/api/v1/jobs/installations/${id}`, { action: 'workDone' }, { label: 'Installation work done', target: `installation:${id}` });

// ------------------------------------------------------- a visit, with calls

export interface VisitCall {
  id: string; startedAt: string; direction: string; durationSec: number; unanswered: boolean;
}

export interface VisitDetail {
  id: string; scheduledAt: string; status: string; purpose: string; outcomeNote: string | null;
  checkedInAt: string | null; checkInWithinRange: boolean | null; technicianName: string;
  complaintId: string; complaintNo: string; description: string;
  customerName: string; phone: string | null;
  siteName: string | null; siteAddress: string | null; siteLat: number | null; siteLng: number | null;
  calls: VisitCall[];
  changes: { kind: string; fromAt: string; toAt: string | null; reason: string; requestedByCustomer: boolean; createdAt: string }[];
}

export const visit = (id: string) =>
  authed<{ visit: VisitDetail; canEdit: boolean }>(`/api/v1/jobs/visits/${id}`);

export const moveVisit = (id: string, scheduledAt: string, reason: string, requestedByCustomer: boolean) =>
  send<{ ok: true }>(`/api/v1/jobs/visits/${id}`, { scheduledAt, reason, requestedByCustomer }, { label: 'Visit moved', target: `visit:${id}` });

// --------------------------------------------------------------- the van

export interface VanItem {
  productId: string; productName: string; productCode: string | null; unit: string | null;
  qty: number; trackingMode: string; units: { id: string; serialNo: string | null }[];
}

export interface Van { id: string; name: string; code: string; items: VanItem[] }

export const myVan = () => authed<{ van: Van | null }>('/api/v1/stock/van');

export const fitFromVan = (body: {
  complaintId?: string | null; challanId?: string | null;
  lines: { productId: string; qty: number; stockUnitIds?: string[] }[];
  note?: string | null;
}) => send<{ ok: true; vanName: string; lines: number }>('/api/v1/stock/van', body, { label: 'Used from the van' });

/** Stock at the branch that can go on my van (4 Oct 2026). `code` = a scanned barcode or serial. */
export interface Movable {
  productId: string; productName: string; productCode: string | null; unit: string | null;
  trackingMode: string; available: number; units: { id: string; serialNo: string | null }[];
}
export const branchStock = (p: { q?: string; code?: string }) =>
  authed<{ items: Movable[]; matchedUnitId: string | null }>(
    `/api/v1/stock/van/load?${p.code ? `code=${encodeURIComponent(p.code)}` : `q=${encodeURIComponent(p.q ?? '')}`}`,
  );
export const loadMyVan = (body: { lines: { productId: string; qty: number; stockUnitIds?: string[] }[]; note?: string | null }) =>
  authed<{ ok: true; vanName: string; lines: number }>('/api/v1/stock/van/load', json(body));

/** A technician's own month on the phone (F-02, 6 Oct 2026) - same figures as Technician Performance on the website. */
export interface MyWorkRow {
  assigned: number; accepted: number; closed: number; openNow: number;
  avgAcceptMin: number | null; avgReachMin: number | null; avgOnSiteMin: number | null; avgCloseMin: number | null;
  slaMissed: number; slaTracked: number; reopened: number; avgRating: number | null; ratings: number;
  partsIssued: number; km: number | null;
}
export interface MyWorkMonth { label: string; row: MyWorkRow | null }
export const myWork = () => authed<{ thisMonth: MyWorkMonth; lastMonth: MyWorkMonth }>('/api/v1/jobs/my-work');

// ------------------------------------------- the simple technician app (13 Oct 2026)
//
// One list of complaints AND installation jobs given to this person, and
// their visits for today and tomorrow (atlas-app server/field-jobs, lib/my-work).

export interface WorkRow {
  kind: 'complaint' | 'installation'; id: string; no: string; customerName: string;
  siteLocation: string | null; problem: string; status: string; statusLabel: string; priority: string;
  givenAt: string; nextVisitAt: string | null; late: boolean; lateReason: string | null; today: boolean;
  customerPhone?: string | null; customerPhoneDial?: string; siteLocationNavigate?: string;
  lat?: number | null; lng?: number | null;
}
export interface ScheduleRow {
  id: string; kind: 'complaint' | 'installation'; jobId: string; no: string; customerName: string;
  siteLocation: string | null; siteLocationNavigate?: string; purpose: string; scheduledAt: string; checkedIn: boolean;
  day: 'earlier' | 'today' | 'tomorrow';
}
export const myJobs = () => authed<{ jobs: WorkRow[]; schedule: ScheduleRow[]; now: string; canEdit: boolean }>('/api/v1/jobs/mine');
