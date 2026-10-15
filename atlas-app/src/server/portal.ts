import 'server-only';
import { customerFiles, type CustomerFile } from './attachments';
import { db } from './db';
import type { StoreScope } from './store-scope';
import { invoiceStatus, amountDuePaise, type InvoiceStatus, type InvoiceLifecycle } from '@/lib/invoice-status';
import {
  listFieldConfigs, listCustomerPurchases, createComplaint,
  ComplaintError, type ComplaintFieldConfigRow,
} from './complaints';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { CUSTOMER_VISIBLE_KINDS, DONE } from '@/lib/job-flow';
import { portalConfig } from './config';

/**
 * Server-side logic for the customer portal.
 *
 * Every function here takes `partyId` resolved from the portal session
 * (server/portal-context.ts), never from client input - the caller (a
 * server action) passes the id straight out of `requirePortalContext()`.
 * Queries are written with an explicit `storeId` filter (the party's own
 * store, also from the session) rather than reusing StoreScope/scopeWhere,
 * since a customer is not "staff scoped to a store" - they are exactly one
 * party in exactly one store, and there is nothing to widen.
 */

export { ComplaintError };

function scopeFor(storeId: string): StoreScope {
  // Always writable - the customer portal's own lifecycle-lock story
  // (should a SUSPENDED/READ_ONLY tenant's portal also stop accepting
  // customer actions?) is a real question but a separate one from
  // Slice 6, which is scoped to staff-facing writes. Not silently
  // changed as a side effect here.
  return { kind: 'single', storeId, writable: true };
}

// --------------------------------------------------------------- purchases

export interface PortalInvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceDate: Date;
  grandTotalPaise: number;
  amountDuePaise: number;
  status: InvoiceStatus;
  items: { productName: string; qty: number; unitPricePaise: number; lineTotalPaise: number }[];
  /** Files marked "Customer sees it" on the invoice and its order (G5, 11 Oct 2026). */
  files: CustomerFile[];
}

export async function listMyInvoices(partyId: string, storeId: string): Promise<PortalInvoiceRow[]> {
  // A client who does not let customers see invoices at all (portal.invoices)
  // gets nothing back, rather than a page that hides rows it was still sent.
  const cfg = await portalConfig(storeId);
  if (!cfg.on('portal.invoices')) return [];

  const rows = await db.invoice.findMany({
    where: { partyId, storeId, lifecycle: { not: 'draft' } },
    include: { items: { select: { productName: true, qty: true, unitPricePaise: true, lineTotalPaise: true } } },
    orderBy: { invoiceDate: 'desc' },
    take: LIST_MAX_ROWS,
  });

  const docs = rows.flatMap((inv) => [
    { docType: 'invoice' as const, docId: inv.id },
    ...(inv.salesOrderId ? [{ docType: 'sales_order' as const, docId: inv.salesOrderId }] : []),
  ]);
  const files = await customerFiles(storeId, docs);

  return rows.map((inv) => {
    const like = {
      lifecycle: inv.lifecycle as InvoiceLifecycle,
      grandTotalPaise: inv.grandTotalPaise,
      amountPaidPaise: inv.amountPaidPaise,
      dueDate: inv.dueDate,
    };
    return {
      id: inv.id, invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate,
      grandTotalPaise: inv.grandTotalPaise,
      // A cancelled invoice is owed by nobody, whatever its paid column says.
      amountDuePaise: like.lifecycle === 'cancelled' ? 0 : amountDuePaise(like),
      status: invoiceStatus(like),
      items: inv.items,
      files: [
        ...(files.get(`invoice:${inv.id}`) ?? []),
        ...(inv.salesOrderId ? files.get(`sales_order:${inv.salesOrderId}`) ?? [] : []),
      ],
    };
  });
}

export interface PurchasedProduct { productId: string; productName: string }

export async function listMyPurchasedProducts(partyId: string, storeId: string): Promise<PurchasedProduct[]> {
  return listCustomerPurchases(scopeFor(storeId), partyId);
}

// -------------------------------------------------------------- complaints

export interface PortalComplaintRow {
  id: string;
  complaintNo: string;
  productName: string | null;
  description: string;
  status: string;
  resolutionType: string | null;
  assignedTechnicianName: string | null;
  createdAt: Date;
}

export async function listMyComplaints(partyId: string, storeId: string): Promise<PortalComplaintRow[]> {
  const rows = await db.complaint.findMany({
    where: { customerId: partyId, storeId },
    include: {
      product: { select: { productName: true } },
      assignedTechnician: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((c) => ({
    id: c.id, complaintNo: c.complaintNo, productName: c.product?.productName ?? null,
    description: c.description, status: c.status, resolutionType: c.resolutionType,
    assignedTechnicianName: c.assignedTechnician?.fullName ?? null,
    createdAt: c.createdAt,
  }));
}

export interface PortalComplaintDetail extends PortalComplaintRow {
  siteLocation: string | null;
  /** Only entries marked visibleToPortal - see ComplaintActivity in schema.prisma. */
  timeline: { id: string; kind: string; body: string | null; statusFrom: string | null; statusTo: string | null; createdAt: Date }[];
  visits: { id: string; purpose: string; scheduledAt: Date; status: string; completedAt: Date | null }[];
  /** The technician's number, only where the client shows it (portal.job.technicianPhone). */
  assignedTechnicianPhone: string | null;
  // No challans: a customer never sees parts, challans or costs (workflow spec §6).
}

/** Returns null both when the complaint does not exist AND when it belongs
 * to someone else - the caller cannot tell the difference, which is the
 * point: a portal user probing ids gets the same "not found" either way. */
export async function getMyComplaintDetail(
  partyId: string, storeId: string, complaintId: string,
): Promise<PortalComplaintDetail | null> {
  const [c, cfg] = await Promise.all([
    db.complaint.findFirst({
      where: { id: complaintId, customerId: partyId, storeId },
      include: {
        product: { select: { productName: true } },
        assignedTechnician: { select: { fullName: true, phone: true } },
        // Both locks: marked visible AND a customer kind (lib/job-flow).
        activities: { where: { visibleToPortal: true, kind: { in: [...CUSTOMER_VISIBLE_KINDS] } }, orderBy: { createdAt: 'desc' } },
        visits: { orderBy: { scheduledAt: 'desc' } },
      },
    }),
    portalConfig(storeId),
  ]);
  if (!c) return null;

  // What the client chose to show this customer (F1a / D15). Applied HERE, on
  // the way out of the server, not in the page: a value the page merely does
  // not render is still in the HTML payload, and "hidden" has to mean absent.
  const showName = cfg.on('portal.job.technicianName');
  const showPhone = cfg.on('portal.job.technicianPhone');
  const showTimeline = cfg.on('portal.job.timeline');

  return {
    id: c.id, complaintNo: c.complaintNo, productName: c.product?.productName ?? null,
    description: c.description, status: c.status, resolutionType: c.resolutionType,
    assignedTechnicianName: showName ? c.assignedTechnician?.fullName ?? null : null,
    assignedTechnicianPhone: showPhone ? c.assignedTechnician?.phone ?? null : null,
    createdAt: c.createdAt, siteLocation: c.siteLocation,
    timeline: showTimeline
      ? c.activities.map((a) => ({
        // A status change's body is the office's reason - staff only (9 Oct 2026).
        id: a.id, kind: a.kind, body: a.kind === 'status_change' ? null : a.body, statusFrom: a.statusFrom, statusTo: a.statusTo, createdAt: a.createdAt,
      }))
      : [],
    visits: c.visits.map((v) => ({
      id: v.id, purpose: v.purpose, scheduledAt: v.scheduledAt, status: v.status, completedAt: v.completedAt,
    })),
  };
}

export async function listMyComplaintFieldConfigs(storeId: string): Promise<ComplaintFieldConfigRow[]> {
  return listFieldConfigs(scopeFor(storeId));
}

export interface CreatePortalComplaintInput {
  productId: string | null;
  siteLocation: string | null;
  /** Null when the business has the GPS pin switched off; createComplaint checks. */
  siteLat: number | null;
  siteLng: number | null;
  siteSource: 'gps' | 'maps_link' | null;
  description: string;
  customFields: Record<string, string>;
}

export async function createPortalComplaint(
  partyId: string, storeId: string, input: CreatePortalComplaintInput,
): Promise<string> {
  // A client may take self-service off entirely (portal.raise) and have
  // complaints come in by phone. Checked on the server, because hiding the
  // button does not stop a crafted POST.
  if (!(await portalConfig(storeId)).on('portal.raise')) {
    throw new ComplaintError('Please call us to report a problem - we do not take them online.');
  }

  // If a product is named, it must be one this party actually bought -
  // listCustomerPurchases is the only source the complaint form is allowed
  // to offer, but the check belongs here too since the id still arrives as
  // ordinary form input and nothing stops a crafted request from naming a
  // productId that came from someone else's invoice.
  if (input.productId) {
    const purchases = await listCustomerPurchases(scopeFor(storeId), partyId);
    if (!purchases.some((p) => p.productId === input.productId)) {
      throw new ComplaintError('You can only raise a complaint against something you have purchased.');
    }
  }

  return createComplaint(scopeFor(storeId), {
    customerId: partyId,
    productId: input.productId,
    siteLocation: input.siteLocation,
    siteLat: input.siteLat, siteLng: input.siteLng, siteSource: input.siteSource,
    description: input.description,
    priority: 'normal',
    customFields: input.customFields,
    raisedByPortal: true,
  }, null);
}

// -------------------------------------------------------------------- home

export interface PortalHomeSummary {
  openComplaints: number;
  totalPurchases: number;
  /** Null - not zero - when this client does not show customers amounts. */
  totalDuePaise: number | null;
  /** The part of it past its due date. Null on the same terms. */
  overduePaise: number | null;
  /** What this client lets a customer do, so the page draws the right buttons. */
  canRaise: boolean;
  showInvoices: boolean;
  /** The shop in the portal (portal.shop). */
  showShop: boolean;
}

export async function getPortalHome(partyId: string, storeId: string): Promise<PortalHomeSummary> {
  const [openComplaints, invoices, cfg] = await Promise.all([
    db.complaint.count({ where: { customerId: partyId, storeId, status: { notIn: [...DONE] } } }),
    // The same invoices My Purchases lists, so the two pages cannot disagree.
    db.invoice.findMany({
      where: { partyId, storeId, lifecycle: { not: 'draft' } },
      select: { lifecycle: true, grandTotalPaise: true, amountPaidPaise: true, dueDate: true },
    }),
    portalConfig(storeId),
  ]);
  const showAmounts = cfg.on('portal.amounts');
  /**
   * Summed from the invoices, NOT read from the party's `currentBalancePaise` column.
   * That column is a running counter other code has to remember to keep in
   * step, and on 3 Oct it said ₹0 for a customer whose purchases page showed
   * ₹49,689.80 overdue - the home page told a debtor they owed nothing.
   */
  let duePaise = 0;
  let overduePaise = 0;
  for (const inv of invoices) {
    const like = { ...inv, lifecycle: inv.lifecycle as InvoiceLifecycle };
    if (like.lifecycle === 'cancelled') continue;
    const due = amountDuePaise(like);
    duePaise += due;
    if (invoiceStatus(like) === 'overdue') overduePaise += due;
  }
  return {
    openComplaints,
    totalPurchases: invoices.length,
    // Null rather than 0: "we do not show this" and "you owe nothing" are
    // different sentences, and a customer who owes money must not be told zero.
    totalDuePaise: showAmounts ? duePaise : null,
    overduePaise: showAmounts ? overduePaise : null,
    canRaise: cfg.on('portal.raise'),
    showInvoices: cfg.on('portal.invoices'),
    showShop: cfg.on('portal.shop'),
  };
}
