import 'server-only';
import { withReach, type SalesReach } from './sales-reach';
import { stageNamer } from './order-stages';
import { stageLabel } from '@/lib/installation-stages';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { invoiceStatus, STATUS_LABEL, type InvoiceLifecycle } from '@/lib/invoice-status';
import { warrantyStart, unitWarrantyMonths } from '@/lib/stock-units';
import { warrantyUntil } from '@/lib/amc-coverage';
import { getWarrantyBasis } from './stock-units';
import { financialYearRange, getFinancialYear } from '@/lib/financial-year';
import type { IconName } from '@/components/ui/Icon';

/**
 * A CUSTOMER'S WHOLE STORY (G-39, 10 Oct 2026). Pravin: "when I open a
 * customer I want the full name, mobile, all the relevant activity and
 * documents, a proper ledger tab - and the detail of where I came from".
 * Designed in 09-documentation/customer-360-demo.html and approved.
 *
 * One read, everything this customer has with the business in the viewer's
 * branches: every document (and which documents each one is linked to),
 * jobs, the serial units they hold, a dated activity stream, the five
 * figures on top, and - when the page was opened from a document - that
 * document and its links (`?via=<kind>:<id>`). The ledger itself comes from
 * `customer-ledger.ts`, the one place balances are worked out.
 */

export type DocType = 'quotation' | 'order' | 'invoice' | 'receipt' | 'credit' | 'return' | 'challan' | 'amc';
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';

export interface C360Doc {
  id: string; type: DocType; no: string; at: Date; amountPaise: number;
  /** Invoices only: what is still unpaid, and when it fell / falls due. */
  duePaise?: number; dueDate?: Date;
  status: { label: string; tone: Tone };
  note: string; href: string;
  /** Ids of the documents (and jobs) this one is linked to. */
  links: string[];
}
export interface C360Job {
  id: string; no: string; at: Date; item: string; status: string; tone: Tone;
  techId: string | null; techName: string | null; href: string; links: string[];
  nextVisit: Date | null;
}
export interface C360Unit {
  id: string; serial: string; productId: string; product: string; status: string;
  invoice: { id: string; no: string } | null; warrantyUntil: Date | null; amc: boolean; href: string;
}
export interface C360Activity {
  id: string; kind: 'sales' | 'money' | 'service' | 'calls'; icon: IconName;
  title: string; detail: string; at: Date; byName: string | null; byId: string | null;
  ref: string | null; href: string | null;
}

const words = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const daysLate = (due: Date, now: Date) => Math.floor((now.getTime() - due.getTime()) / 86_400_000);
const CLOSED_JOB = ['closed', 'cancelled'];

const INVOICE_TONE: Record<string, Tone> = { paid: 'success', overdue: 'danger', partially_paid: 'warning', sent: 'warning', pending: 'warning', draft: 'neutral', cancelled: 'neutral' };
const QUOTE_TONE: Record<string, Tone> = { converted: 'success', accepted: 'success', sent: 'info', draft: 'neutral', rejected: 'danger', expired: 'neutral' };

export async function customer360(scope: StoreScope, partyId: string, via: string | undefined, now = new Date(), reach: SalesReach | null = null) {
  const party = await db.party.findFirst({
    where: { id: partyId, ...scopeWhere(scope) },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true, companyName: true,
      phoneCc: true, phone: true, altPhone: true, email: true, gstin: true, addressLine1: true, city: true, state: true, pincode: true,
      status: true, customerSince: true, source: true, creditLimitPaise: true, creditLimitDays: true, assignedManagerId: true,
      portalEnabled: true, isSupplier: true,
    },
  });
  if (!party) return null;

  const mine = { ...scopeWhere(scope), partyId };
  const [quotes, orders, invoices, receipts, credits, returns, challans, amcs, complaints, units, sites, basis] = await Promise.all([
    // Their own (or team's) documents only, when the role says so (B4 step 3).
    db.quotation.findMany({ where: withReach({ ...scopeWhere(scope), partyId }, reach), orderBy: { quotationDate: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, quotationNo: true, quotationDate: true, grandTotalPaise: true, status: true } }),
    db.salesOrder.findMany({ where: withReach({ ...scopeWhere(scope), partyId }, reach), orderBy: { orderDate: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, orderNo: true, orderDate: true, grandTotalPaise: true, amountPaidPaise: true, fulfilmentStatus: true, quotationId: true } }),
    db.invoice.findMany({ where: withReach({ ...scopeWhere(scope), partyId }, reach), orderBy: { invoiceDate: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, invoiceNo: true, invoiceDate: true, dueDate: true, grandTotalPaise: true, amountPaidPaise: true, lifecycle: true, salesOrderId: true } }),
    db.receipt.findMany({ where: { ...mine }, orderBy: { receivedAt: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, receiptNo: true, receivedAt: true, amountPaise: true, method: true, status: true, allocations: { select: { invoiceId: true, amountPaise: true } } } }),
    db.creditNote.findMany({ where: { ...scopeWhere(scope), partyId }, orderBy: { creditNoteDate: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, creditNoteNo: true, creditNoteDate: true, grandTotalPaise: true, lifecycle: true, reason: true, invoiceId: true } }),
    db.salesReturn.findMany({ where: { ...scopeWhere(scope), partyId }, orderBy: { returnedAt: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, returnNo: true, returnedAt: true, lifecycle: true, reason: true, invoiceId: true } }),
    db.installationChallan.findMany({ where: { ...scopeWhere(scope), salesOrder: { partyId } }, orderBy: { dispatchedAt: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, challanNo: true, dispatchedAt: true, status: true, stage: true, salesOrderId: true, items: { select: { qty: true, fitStatus: true } } } }),
    db.amcContract.findMany({ where: { ...scopeWhere(scope), customerId: partyId }, orderBy: { startDate: 'desc' }, take: LIST_MAX_ROWS, select: { id: true, contractNo: true, startDate: true, endDate: true, amountPaise: true, status: true, invoiceId: true } }),
    db.complaint.findMany({
      where: { ...scopeWhere(scope), customerId: partyId }, orderBy: { createdAt: 'desc' }, take: LIST_MAX_ROWS,
      select: {
        id: true, complaintNo: true, createdAt: true, status: true, description: true, assignedTechnicianId: true, invoiceId: true, salesOrderId: true,
        visits: { where: { status: 'scheduled' }, orderBy: { scheduledAt: 'asc' }, take: 1, select: { scheduledAt: true } },
      },
    }),
    db.stockUnit.findMany({
      where: { ...scopeWhere(scope), partyId }, orderBy: { receivedAt: 'desc' }, take: LIST_MAX_ROWS,
      select: {
        id: true, serialNo: true, status: true, warrantyMonths: true, productId: true,
        product: { select: { productName: true, warrantyMonths: true } },
        invoice: { select: { id: true, invoiceNo: true, invoiceDate: true } },
        challanItems: { take: 1, select: { challan: { select: { dispatchedAt: true, completedAt: true } } } },
      },
    }),
    db.partySite.findMany({ where: { partyId, ...scopeWhere(scope) }, take: LIST_MAX_ROWS, select: { id: true, name: true, address: true, contactName: true, contactPhone: true, latitude: true, longitude: true } }),
    getWarrantyBasis(scope),
  ]);

  // Who - technicians, the account manager, callers - in one lookup.
  const calls = await db.callLog.findMany({
    where: { ...scopeWhere(scope), e164Number: { endsWith: party.phone.replace(/\D/g, '').slice(-10) } },
    orderBy: { startedAt: 'desc' }, take: LIST_MAX_ROWS,
    select: { id: true, direction: true, startedAt: true, durationSec: true, userId: true },
  });
  const userIds = [...new Set([party.assignedManagerId, ...complaints.map((c) => c.assignedTechnicianId), ...calls.map((c) => c.userId)].filter((x): x is string => !!x))];
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds }, storeRoles: { some: { storeId: scope.kind === 'single' ? scope.storeId : { in: scope.storeIds } } } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));

  /* ---------------------------------------------------------- documents */
  const docs: C360Doc[] = [];
  const invNo = new Map(invoices.map((i) => [i.id, i.invoiceNo]));
  for (const q of quotes) {
    docs.push({
      id: q.id, type: 'quotation', no: q.quotationNo, at: q.quotationDate, amountPaise: q.grandTotalPaise,
      status: { label: words(q.status), tone: QUOTE_TONE[q.status] ?? 'neutral' },
      note: orders.some((o) => o.quotationId === q.id) ? `Became ${orders.find((o) => o.quotationId === q.id)!.orderNo}` : '',
      href: `/quotation/${q.id}`, links: orders.filter((o) => o.quotationId === q.id).map((o) => o.id),
    });
  }
  const orderStage = await stageNamer(scope);
  for (const o of orders) {
    const inv = invoices.filter((i) => i.salesOrderId === o.id);
    docs.push({
      id: o.id, type: 'order', no: o.orderNo, at: o.orderDate, amountPaise: o.grandTotalPaise,
      status: { label: orderStage(o.fulfilmentStatus), tone: ['delivered', 'completed'].includes(o.fulfilmentStatus) ? 'success' : ['void', 'failed', 'returned'].includes(o.fulfilmentStatus) ? 'neutral' : 'info' },
      note: [o.quotationId ? `Against ${quotes.find((q) => q.id === o.quotationId)?.quotationNo ?? 'a quotation'}` : '', inv.length ? `Invoiced on ${inv.map((i) => i.invoiceNo).join(', ')}` : ''].filter(Boolean).join(' · '),
      href: `/sales/orders/${o.id}`,
      links: [...(o.quotationId ? [o.quotationId] : []), ...inv.map((i) => i.id), ...challans.filter((c) => c.salesOrderId === o.id).map((c) => c.id)],
    });
  }
  for (const i of invoices) {
    const st = invoiceStatus({ lifecycle: i.lifecycle as InvoiceLifecycle, grandTotalPaise: i.grandTotalPaise, amountPaidPaise: i.amountPaidPaise, dueDate: i.dueDate }, now);
    const due = ['draft', 'cancelled'].includes(i.lifecycle) ? 0 : Math.max(0, i.grandTotalPaise - i.amountPaidPaise);
    const late = st === 'overdue' ? daysLate(i.dueDate, now) : 0;
    docs.push({
      id: i.id, type: 'invoice', no: i.invoiceNo, at: i.invoiceDate, amountPaise: i.grandTotalPaise, duePaise: due, dueDate: i.dueDate,
      status: { label: st === 'overdue' ? `Overdue ${late} day${late === 1 ? '' : 's'}` : due > 0 && st !== 'draft' ? `${STATUS_LABEL[st]} · due ${day(i.dueDate)}` : STATUS_LABEL[st], tone: INVOICE_TONE[st] ?? 'neutral' },
      note: [i.salesOrderId ? `From ${orders.find((o) => o.id === i.salesOrderId)?.orderNo ?? 'an order'}` : '', due > 0 && i.amountPaidPaise > 0 ? `${rupees(due)} still due` : ''].filter(Boolean).join(' · '),
      href: `/invoices/${i.id}`,
      links: [
        ...(i.salesOrderId ? [i.salesOrderId] : []),
        ...receipts.filter((r) => r.allocations.some((a) => a.invoiceId === i.id)).map((r) => r.id),
        ...credits.filter((c) => c.invoiceId === i.id).map((c) => c.id),
        ...returns.filter((r) => r.invoiceId === i.id).map((r) => r.id),
        ...amcs.filter((a) => a.invoiceId === i.id).map((a) => a.id),
      ],
    });
  }
  for (const r of receipts) {
    const against = r.allocations.map((a) => invNo.get(a.invoiceId)).filter(Boolean);
    docs.push({
      id: r.id, type: 'receipt', no: r.receiptNo, at: r.receivedAt, amountPaise: r.amountPaise,
      status: r.status === 'received' ? { label: `Received · ${words(r.method)}`, tone: 'success' } : { label: words(r.status), tone: 'danger' },
      note: against.length ? `Against ${against.join(', ')}` : 'On account', href: `/receipts/${r.id}`,
      links: r.allocations.map((a) => a.invoiceId),
    });
  }
  for (const c of credits) {
    docs.push({
      id: c.id, type: 'credit', no: c.creditNoteNo, at: c.creditNoteDate, amountPaise: c.grandTotalPaise,
      status: { label: words(c.lifecycle), tone: c.lifecycle === 'issued' ? 'success' : c.lifecycle === 'draft' ? 'warning' : 'neutral' },
      note: [c.reason, `on ${invNo.get(c.invoiceId) ?? 'an invoice'}`].filter(Boolean).join(' · '), href: `/credit-notes/${c.id}`, links: [c.invoiceId],
    });
  }
  for (const r of returns) {
    docs.push({
      id: r.id, type: 'return', no: r.returnNo, at: r.returnedAt, amountPaise: 0,
      status: { label: words(r.lifecycle), tone: 'neutral' },
      note: [r.reason, `from ${invNo.get(r.invoiceId) ?? 'an invoice'}`].filter(Boolean).join(' · '), href: `/sales-return/${r.id}`, links: [r.invoiceId],
    });
  }
  for (const c of challans) {
    docs.push({
      id: c.id, type: 'challan', no: c.challanNo, at: c.dispatchedAt, amountPaise: 0,
      // The working stage the installation page shows (G8, 11 Oct 2026); a
      // sent-back one still says so.
      status: { label: c.status === 'rejected' ? 'Sent back' : stageLabel(c.stage), tone: c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'info' },
      note: `${c.items.filter((i) => i.fitStatus !== 'to_fit').length} of ${c.items.length} fitted`, href: `/services/installations/${c.id}`,
      links: c.salesOrderId ? [c.salesOrderId] : [],
    });
  }
  for (const a of amcs) {
    const active = a.status === 'active' && a.endDate >= now;
    docs.push({
      id: a.id, type: 'amc', no: a.contractNo, at: a.startDate, amountPaise: a.amountPaise,
      status: { label: active ? `Active · to ${day(a.endDate)} ${a.endDate.getFullYear()}` : words(a.status), tone: active ? 'success' : 'neutral' },
      note: `${day(a.startDate)} ${a.startDate.getFullYear()} → ${day(a.endDate)} ${a.endDate.getFullYear()}`,
      href: `/services/amc?open=${a.id}`, links: a.invoiceId ? [a.invoiceId] : [],
    });
  }

  /* -------------------------------------------------------- jobs, items */
  const jobs: C360Job[] = complaints.map((c) => ({
    id: c.id, no: c.complaintNo, at: c.createdAt, item: c.description, status: words(c.status),
    tone: CLOSED_JOB.includes(c.status) ? 'success' : c.status === 'visit_booked' ? 'info' : 'warning',
    techId: c.assignedTechnicianId, techName: c.assignedTechnicianId ? users.get(c.assignedTechnicianId) ?? null : null,
    href: `/services/complaints/${c.id}`, links: [c.invoiceId, c.salesOrderId].filter((x): x is string => !!x),
    nextVisit: c.visits[0]?.scheduledAt ?? null,
  }));
  const activeAmc = amcs.some((a) => a.status === 'active' && a.endDate >= now);
  const itemsHeld: C360Unit[] = units.filter((u) => u.serialNo).map((u) => {
    const install = u.challanItems[0]?.challan ?? null;
    const starts = warrantyStart({ basis, invoiceDate: u.invoice?.invoiceDate ?? null, installDate: install ? (install.completedAt ?? install.dispatchedAt) : null });
    return {
      id: u.id, serial: u.serialNo!, productId: u.productId, product: u.product.productName, status: words(u.status),
      invoice: u.invoice ? { id: u.invoice.id, no: u.invoice.invoiceNo } : null,
      warrantyUntil: warrantyUntil({ productId: u.productId, soldOn: starts, warrantyMonths: unitWarrantyMonths(u.warrantyMonths, u.product.warrantyMonths) }),
      amc: activeAmc, href: `/stock-units?q=${encodeURIComponent(u.serialNo!)}&open=${u.id}`,
    };
  });

  /* ------------------------------------------------------------ activity */
  const activity: C360Activity[] = [];
  const push = (a: Omit<C360Activity, 'byName' | 'byId'> & { byId?: string | null }) => activity.push({ ...a, byId: a.byId ?? null, byName: a.byId ? users.get(a.byId) ?? null : null });
  for (const d of docs) {
    const t = ({ quotation: ['sales', 'file-text', 'Quotation'], order: ['sales', 'shopping-cart', 'Sales order'], invoice: ['sales', 'receipt', 'Invoice'], receipt: ['money', 'credit-card', 'Payment received'], credit: ['money', 'rotate-ccw', 'Credit note'], return: ['sales', 'rotate-ccw', 'Return'], challan: ['service', 'truck', 'Installation'], amc: ['service', 'shield-check', 'AMC'] } as Record<DocType, [C360Activity['kind'], IconName, string]>)[d.type];
    push({ id: `d-${d.id}`, kind: t[0], icon: t[1], title: d.type === 'receipt' ? `${t[2]} · ${rupees(d.amountPaise)}` : `${t[2]} ${d.no}`, detail: [d.status.label, d.note, d.type !== 'receipt' && d.amountPaise ? rupees(d.amountPaise) : ''].filter(Boolean).join(' · '), at: d.at, ref: d.id, href: d.href });
  }
  for (const j of jobs) {
    push({ id: `j-${j.id}`, kind: 'service', icon: 'wrench', title: `Complaint ${j.no} raised`, detail: [j.item, j.status, j.techName ? `with ${j.techName}` : ''].filter(Boolean).join(' · '), at: j.at, ref: j.id, href: j.href, byId: null });
    if (j.nextVisit) push({ id: `v-${j.id}`, kind: 'service', icon: 'calendar', title: `Visit booked for ${j.no}`, detail: j.nextVisit.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), at: j.nextVisit > now ? now : j.nextVisit, ref: j.id, href: j.href, byId: j.techId });
  }
  for (const c of calls) {
    const mins = Math.floor(c.durationSec / 60), secs = c.durationSec % 60;
    push({ id: `c-${c.id}`, kind: 'calls', icon: 'phone', title: `${c.direction === 'incoming' ? 'Incoming' : c.direction === 'missed' ? 'Missed' : 'Outgoing'} call${c.durationSec ? ` · ${mins ? `${mins} m ` : ''}${secs} s` : ''}`, detail: c.durationSec ? 'Connected' : 'Not connected', at: c.startedAt, ref: null, href: null, byId: c.userId });
  }
  activity.sort((a, b) => b.at.getTime() - a.at.getTime());

  /* ------------------------------------------------------------- figures */
  const live = docs.filter((d) => d.type === 'invoice' && !['Draft', 'Cancelled'].includes(d.status.label));
  const owing = live.filter((d) => (d.duePaise ?? 0) > 0);
  const late = owing.filter((d) => d.dueDate! < now && d.status.tone === 'danger');
  const fy = financialYearRange(getFinancialYear(now));
  const paid = receipts.filter((r) => r.status === 'received');
  const bucket = (lo: number, hi: number) => owing.filter((d) => { const n = daysLate(d.dueDate!, now); return n >= lo && n <= hi; }).reduce((s, d) => s + (d.duePaise ?? 0), 0);
  const figures = {
    lifetimePaise: live.reduce((s, d) => s + d.amountPaise, 0), invoiceCount: live.length,
    overduePaise: late.reduce((s, d) => s + (d.duePaise ?? 0), 0),
    oldestDays: late.length ? Math.max(...late.map((d) => daysLate(d.dueDate!, now))) : 0,
    paidFyPaise: paid.filter((r) => r.receivedAt >= fy.start && r.receivedAt <= fy.end).reduce((s, r) => s + r.amountPaise, 0),
    lastPaymentAt: paid[0]?.receivedAt ?? null,
    openJobs: jobs.filter((j) => j.tone !== 'success').length,
    nextVisit: jobs.map((j) => j.nextVisit).filter((d): d is Date => !!d && d >= now).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    activeAmc: amcs.find((a) => a.status === 'active' && a.endDate >= now) ?? null,
    inWarranty: itemsHeld.filter((u) => u.warrantyUntil && u.warrantyUntil >= now).length,
    aging: [
      { key: 'Not due', paise: bucket(-100000, 0), tone: 'success' as Tone }, { key: '1-30 days', paise: bucket(1, 30), tone: 'warning' as Tone },
      { key: '31-60', paise: bucket(31, 60), tone: 'warning' as Tone }, { key: '61-90', paise: bucket(61, 90), tone: 'danger' as Tone }, { key: '90+', paise: bucket(91, 1e9), tone: 'danger' as Tone },
    ],
  };

  /* --------------------------------------------- where it was opened from */
  const viaId = via?.split(':')[1];
  const fromDoc = viaId ? docs.find((d) => d.id === viaId) : undefined;
  const fromJob = viaId && !fromDoc ? jobs.find((j) => j.id === viaId) : undefined;
  const from = fromDoc
    ? { kind: fromDoc.type, id: fromDoc.id, no: fromDoc.no, href: fromDoc.href, links: fromDoc.links, lines: [`${fromDoc.amountPaise ? `${rupees(fromDoc.amountPaise)} · ` : ''}${day(fromDoc.at)}`, fromDoc.status.label, fromDoc.note].filter(Boolean) }
    : fromJob
      ? { kind: 'complaint' as const, id: fromJob.id, no: fromJob.no, href: fromJob.href, links: fromJob.links, lines: [fromJob.item, fromJob.status, fromJob.techName ? `with ${fromJob.techName}` : ''].filter(Boolean) }
      : null;

  return {
    party: {
      ...party,
      name: [party.title, party.firstName, party.lastName].filter(Boolean).join(' ').trim(),
      address: [party.addressLine1, party.city, party.state, party.pincode].filter(Boolean).join(', '),
      managerName: party.assignedManagerId ? users.get(party.assignedManagerId) ?? null : null,
    },
    docs: docs.sort((a, b) => b.at.getTime() - a.at.getTime()),
    jobs, items: itemsHeld, activity, figures, from,
    sites: sites.map((s) => ({ ...s, latitude: s.latitude ? Number(s.latitude) : null, longitude: s.longitude ? Number(s.longitude) : null })),
  };
}
export type Customer360 = NonNullable<Awaited<ReturnType<typeof customer360>>>;
