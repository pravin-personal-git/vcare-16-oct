import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { publicBrandUrl } from './storage';
import { getOrderStages } from './order-stages';
import { customerFiles, type CustomerFile } from './attachments';
import { shownStages, stageName } from '@/lib/order-stages';
import { FULFILMENT_FLOW, type FulfilmentStatus } from '@/lib/sales-order-status';
import { INSTALL_STAGES, isInstallStage, stageIndex } from '@/lib/installation-stages';

/**
 * A NO-LOGIN LINK FOR EVERY DOCUMENT THE CUSTOMER IS SENT (A2, 11 Oct 2026).
 *
 * Quotations had /q and invoices /i; a sales order and an installation went
 * out on WhatsApp as one line of text with nothing to open. Now /o/<token>
 * (order) and /c/<token> (installation), minted the same way: 24 random
 * bytes on first send, the token IS the credential, never indexed.
 *
 * NO PRICES on either (Pravin, W2): the order link shows the items and where
 * the order has got to, the installation link the items, the stage, what is
 * fitted, the handover and the warranty. Prices go out on the quotation and
 * the invoice. Built as their own small views rather than by trimming the
 * office's page data, so a field added to the office page can never leak
 * here by accident - the customer sees only what is listed below.
 */

export class CustomerLinkError extends Error {}

async function mint(): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return randomBytes(24).toString('base64url');
}

/** Orders that never went ahead have nothing to show a customer. */
const NO_LINK: FulfilmentStatus[] = ['void'];

export async function ensureOrderShareToken(scope: StoreScope, id: string): Promise<string> {
  const o = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    select: { id: true, fulfilmentStatus: true, publicToken: true },
  });
  if (!o) throw new Error('Order not found in your scope.');
  if (NO_LINK.includes(o.fulfilmentStatus as FulfilmentStatus)) throw new CustomerLinkError('A cancelled order cannot be sent to the customer.');
  if (o.publicToken) return o.publicToken;
  const token = await mint();
  await db.salesOrder.update({ where: { id }, data: { publicToken: token } });
  return token;
}

export async function ensureInstallationShareToken(scope: StoreScope, id: string): Promise<string> {
  const c = await db.installationChallan.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    select: { id: true, publicToken: true },
  });
  if (!c) throw new Error('Installation not found in your scope.');
  if (c.publicToken) return c.publicToken;
  const token = await mint();
  await db.installationChallan.update({ where: { id }, data: { publicToken: token } });
  return token;
}

interface Business { name: string; logoUrl: string | null; mobile: string | null; branch: string }

export interface PublicOrder {
  orderNo: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  customerName: string;
  business: Business;
  /** The business's own stage names, in order, with where the order is. */
  steps: { label: string; done: boolean; current: boolean }[];
  /** On hold, failed, returned… - said in words, outside the steps. */
  exception: string | null;
  items: { name: string; qty: number; dispatched: number }[];
  courier: { awbNo: string | null } | null;
  installations: { no: string; stage: string }[];
  files: CustomerFile[];
}

export async function getOrderByToken(token: string): Promise<PublicOrder | null> {
  if (!token || token.length < 20) return null;
  const o = await db.salesOrder.findUnique({
    where: { publicToken: token },
    select: {
      id: true, storeId: true, orderNo: true, orderDate: true, expectedDeliveryDate: true, customerName: true,
      fulfilmentStatus: true, awbNo: true, deletedAt: true,
      store: { select: { name: true, organization: { select: { name: true, logoPath: true, mobile: true } } } },
      items: { orderBy: { srNo: 'asc' }, select: { productName: true, qty: true, dispatchedQty: true } },
      installationChallans: { where: { deletedAt: null }, orderBy: { dispatchedAt: 'asc' }, select: { challanNo: true, stage: true } },
    },
  });
  if (!o || o.deletedAt || NO_LINK.includes(o.fulfilmentStatus as FulfilmentStatus)) return null;

  const cfg = await getOrderStages(o.storeId);
  const status = o.fulfilmentStatus as FulfilmentStatus;
  const flow = shownStages(cfg);
  const at = flow.indexOf(status);
  // An exception (hold, returned…) keeps the steps as far as the order got.
  const reached = at >= 0 ? at : Math.max(-1, ...flow.map((s, i) => (FULFILMENT_FLOW.indexOf(s) <= FULFILMENT_FLOW.indexOf(status) ? i : -1)));
  const files = (await customerFiles(o.storeId, [{ docType: 'sales_order', docId: o.id }])).get(`sales_order:${o.id}`) ?? [];

  return {
    orderNo: o.orderNo,
    orderDate: o.orderDate,
    expectedDeliveryDate: o.expectedDeliveryDate,
    customerName: o.customerName,
    business: business(o.store),
    steps: flow.map((s, i) => ({ label: stageName(cfg, s), done: i <= reached, current: i === at })),
    exception: at >= 0 ? null : stageName(cfg, status),
    items: o.items.map((i) => ({ name: i.productName, qty: i.qty, dispatched: i.dispatchedQty })),
    courier: o.awbNo ? { awbNo: o.awbNo } : null,
    installations: o.installationChallans.map((c) => ({ no: c.challanNo, stage: INSTALL_STAGES[stageIndex(c.stage)]!.label })),
    files,
  };
}

const FIT_LABEL: Record<string, string> = { to_fit: 'To be fitted', fitted: 'Fitted', tested: 'Fitted and tested' };

export interface PublicInstallation {
  challanNo: string;
  orderNo: string | null;
  customerName: string | null;
  business: Business;
  site: string | null;
  steps: { label: string; done: boolean; current: boolean }[];
  /** The office sent it back - said plainly, without the internal reason. */
  sentBack: boolean;
  nextVisit: Date | null;
  items: { name: string; qty: number; placement: string | null; serialNo: string | null; fit: string; warrantyUntil: Date | null }[];
  handover: { at: Date; to: string | null } | null;
  files: CustomerFile[];
}

/** Product warranty counted from the handover - the date it starts (installation page, handover). */
export function warrantyEnd(from: Date | null, months: number | null | undefined): Date | null {
  if (!from || !months || months <= 0) return null;
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function getInstallationByToken(token: string): Promise<PublicInstallation | null> {
  if (!token || token.length < 20) return null;
  const c = await db.installationChallan.findUnique({
    where: { publicToken: token },
    select: {
      id: true, storeId: true, challanNo: true, stage: true, status: true, siteLocation: true,
      handoverAt: true, handoverTo: true, deletedAt: true,
      store: { select: { name: true, organization: { select: { name: true, logoPath: true, mobile: true } } } },
      salesOrder: { select: { orderNo: true, customerName: true } },
      items: { orderBy: { srNo: 'asc' }, select: { productName: true, qty: true, placement: true, serialNo: true, barcode: true, fitStatus: true, product: { select: { warrantyMonths: true } } } },
      visits: { where: { status: 'scheduled', scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 1, select: { scheduledAt: true } },
    },
  });
  if (!c || c.deletedAt) return null;

  const stage = isInstallStage(c.stage) ? c.stage : 'planned';
  const at = stageIndex(stage);
  const files = (await customerFiles(c.storeId, [{ docType: 'installation_challan', docId: c.id }])).get(`installation_challan:${c.id}`) ?? [];

  return {
    challanNo: c.challanNo,
    orderNo: c.salesOrder?.orderNo ?? null,
    customerName: c.salesOrder?.customerName ?? null,
    business: business(c.store),
    site: c.siteLocation,
    steps: INSTALL_STAGES.map((s, i) => ({ label: s.label, done: i <= at, current: i === at })),
    sentBack: c.status === 'rejected',
    nextVisit: c.visits[0]?.scheduledAt ?? null,
    items: c.items.map((i) => ({
      name: i.productName, qty: i.qty, placement: i.placement, serialNo: i.serialNo ?? i.barcode,
      fit: FIT_LABEL[i.fitStatus] ?? i.fitStatus,
      warrantyUntil: warrantyEnd(c.handoverAt, i.product?.warrantyMonths),
    })),
    handover: c.handoverAt ? { at: c.handoverAt, to: c.handoverTo } : null,
    files,
  };
}

function business(store: { name: string; organization: { name: string; logoPath: string | null; mobile: string | null } }): Business {
  return {
    name: store.organization.name,
    logoUrl: publicBrandUrl(store.organization.logoPath),
    mobile: store.organization.mobile,
    branch: store.name,
  };
}
