import 'server-only';
import { db } from './db';
import { customerLabel } from '@/lib/job-flow';

/**
 * The service report for a finished job (workflow slice 6, spec §4.7):
 * what was done, parts used (names and quantities - never challan numbers or
 * costs), visits, time on site, the technician, and how the customer
 * confirmed. The same data for the office page and the customer's link.
 */
export interface ServiceReportData {
  businessName: string; branchName: string; branchAddress: string | null;
  complaintNo: string; status: string; statusLabel: string; raisedAt: Date; resolvedAt: Date | null; closedAt: Date | null;
  customerName: string; customerPhone: string; siteLocation: string | null;
  productName: string | null; problem: string;
  technicianName: string | null;
  workDone: string[];
  parts: { name: string; qty: number }[];
  visits: { at: Date; done: boolean }[];
  timeOnSiteSec: number;
  confirmation: string;
  rating: number | null;
  techRating: number | null;
}

export async function serviceReportData(complaintId: string): Promise<ServiceReportData | null> {
  const c = await db.complaint.findUnique({
    where: { id: complaintId },
    include: {
      customer: { select: { companyName: true, firstName: true, lastName: true, phone: true } },
      product: { select: { productName: true } },
      assignedTechnician: { select: { fullName: true } },
      store: { select: { name: true, address: true, organization: { select: { name: true } } } },
      visits: { where: { status: { not: 'cancelled' } }, orderBy: { scheduledAt: 'asc' }, select: { scheduledAt: true, completedAt: true, checkedInAt: true } },
      jobChallans: { where: { status: 'issued' }, select: { lines: { select: { qty: true, qtyReturned: true, product: { select: { productName: true } } } } } },
      activities: { where: { kind: 'status_change', body: { startsWith: 'Work done' } }, orderBy: { createdAt: 'asc' }, select: { body: true } },
    },
  });
  if (!c) return null;
  const parts = new Map<string, number>();
  for (const ch of c.jobChallans) for (const l of ch.lines) {
    const used = l.qty - l.qtyReturned;
    if (used > 0) parts.set(l.product.productName, (parts.get(l.product.productName) ?? 0) + used);
  }
  const confirmation = c.signOff === 'otp' ? 'Confirmed by the customer with their code'
    : c.signOff === 'customer' ? 'Confirmed by the customer'
      : c.signOff === 'technician' ? (c.needsCallback ? 'Technician reported the customer approved; confirmed by phone with the office' : 'Marked done by the technician')
        : c.signOff === 'office' ? 'Marked done by the office' : '-';
  return {
    businessName: c.store.organization.name, branchName: c.store.name, branchAddress: c.store.address,
    complaintNo: c.complaintNo, status: c.status, statusLabel: customerLabel(c.status), raisedAt: c.createdAt, resolvedAt: c.resolvedAt, closedAt: c.closedAt,
    customerName: c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '),
    customerPhone: c.customer.phone, siteLocation: c.siteLocation,
    productName: c.product?.productName ?? null, problem: c.description,
    technicianName: c.assignedTechnician?.fullName ?? null,
    workDone: c.activities.map((a) => (a.body ?? '').replace(/^Work done:?\s*/, '')).filter(Boolean),
    parts: [...parts.entries()].map(([name, qty]) => ({ name, qty })),
    visits: c.visits.map((v) => ({ at: v.checkedInAt ?? v.scheduledAt, done: !!v.completedAt || !!v.checkedInAt })),
    timeOnSiteSec: c.timeOnSiteSec,
    confirmation,
    rating: c.ratingStars,
    techRating: c.techRatingStars,
  };
}
