import 'server-only';
import { db } from './db';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import { getLeadDetail, type LeadDetail } from './lead-detail';

/**
 * ONE ENQUIRY ON ITS OWN PAGE (29 Oct 2026, Vcare: "give each enquiry a
 * standalone page just like installations"). The lead's detail plus
 * everything that came out of it - quotations, their orders, the
 * installations and bills of those orders, the customer it became - and its
 * stage history, so the page can show the whole chain and one timeline.
 */
export interface EnquiryPage extends LeadDetail {
  stages: { id: string; name: string; isWon: boolean; isLost: boolean }[];
  dealStages: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  customer: { id: string; name: string; partyCode: string } | null;
  orders: { id: string; orderNo: string; status: string; grandTotalPaise: number; orderDate: Date; quotationId: string | null }[];
  installations: { id: string; challanNo: string; status: string; createdAt: Date }[];
  invoices: { id: string; invoiceNo: string; grandTotalPaise: number; amountPaidPaise: number; invoiceDate: Date }[];
  stageChanges: { id: string; from: string | null; to: string | null; at: Date; author: string | null }[];
}

export async function getEnquiryPage(scope: StoreScope, id: string): Promise<EnquiryPage | null> {
  const lead = await getLeadDetail(scope, id);
  if (!lead) return null;
  const where = scopeWhere(scope);
  const qIds = lead.quotations.map((q) => q.id);

  const [stages, dealStages, users, customer, orders, stageLogs] = await Promise.all([
    db.leadStage.findMany({
      where: { ...where, isActive: true, isGroupHeader: false },
      orderBy: { sort: 'asc' },
      select: { id: true, name: true, isWon: true, isLost: true },
    }),
    db.leadDealStage.findMany({ where: { ...where, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true, ...userInScope(scope) }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    lead.convertedCustomerId
      ? db.party.findFirst({ where: { id: lead.convertedCustomerId, ...where }, select: { id: true, partyCode: true, firstName: true, lastName: true, companyName: true } })
      : null,
    qIds.length
      ? db.salesOrder.findMany({
        where: { ...where, quotationId: { in: qIds } },
        orderBy: { orderDate: 'desc' },
        select: { id: true, orderNo: true, fulfilmentStatus: true, grandTotalPaise: true, orderDate: true, quotationId: true },
      })
      : [],
    db.activityLog.findMany({
      where: { ...where, entityType: 'Lead', entityId: id, activityType: 'Lead Status Change' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, statusFrom: true, statusTo: true, createdAt: true, user: { select: { fullName: true } } },
    }),
  ]);

  const orderIds = orders.map((o) => o.id);
  const [installations, invoices] = orderIds.length
    ? await Promise.all([
      db.installationChallan.findMany({
        where: { ...where, salesOrderId: { in: orderIds } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, challanNo: true, status: true, createdAt: true },
      }),
      db.invoice.findMany({
        where: { ...where, salesOrderId: { in: orderIds } },
        orderBy: { invoiceDate: 'desc' },
        select: { id: true, invoiceNo: true, grandTotalPaise: true, amountPaidPaise: true, invoiceDate: true },
      }),
    ])
    : [[], []];

  return {
    ...lead,
    stages,
    dealStages,
    users,
    customer: customer
      ? { id: customer.id, partyCode: customer.partyCode, name: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') }
      : null,
    orders: orders.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.fulfilmentStatus, grandTotalPaise: o.grandTotalPaise, orderDate: o.orderDate, quotationId: o.quotationId })),
    installations,
    invoices,
    stageChanges: stageLogs.map((s) => ({ id: s.id, from: s.statusFrom, to: s.statusTo, at: s.createdAt, author: s.user?.fullName ?? null })),
  };
}
