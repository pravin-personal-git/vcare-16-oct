import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { sendOn } from './messaging';
import { PDF_ENGINE_READY } from './pdf-engine';
import { docMessage, type DocKind } from '@/lib/wa-message';
import type { AppContext } from './context';

/**
 * A DOCUMENT AS A PDF, FROM THE BUSINESS'S OWN WHATSAPP NUMBER (A3, 12 Oct 2026).
 *
 * The buttons until now opened the salesperson's own WhatsApp with a link
 * (A1). With the Cloud API set up for the branch (Settings > Email &
 * WhatsApp), Atlas sends the PDF itself, from the business number, inside
 * the approved document template - and records what became of it (sent,
 * delivered, read, failed) from Meta's webhook (api/webhooks/whatsapp).
 *
 * "Open in my WhatsApp" stays as the fallback wherever this is not ready.
 */

export type SendDocType = 'invoice' | 'quotation' | 'order';

export interface WhatsAppApiState {
  /** The branch can send a PDF from its business number now. */
  ready: boolean;
  /** Why not, in words - shown on the button. */
  reason: string | null;
}

/** Is the branch set up to send a PDF through the API? Read without decrypting anything. */
export async function whatsappApiState(storeId: string | null): Promise<WhatsAppApiState> {
  if (!storeId) return { ready: false, reason: 'Pick a branch first.' };
  const row = await db.messagingChannel.findUnique({
    where: { storeId_channel: { storeId, channel: 'whatsapp' } },
    select: { provider: true, isActive: true, credentials: true },
  });
  const c = (row?.credentials ?? {}) as Record<string, string>;
  if (!row || !row.isActive || row.provider !== 'whatsapp_cloud' || !c.phoneNumberId || !c.accessToken) {
    return { ready: false, reason: 'WhatsApp Business is not set up for this branch (Settings > Email & WhatsApp).' };
  }
  if (!c.docTemplate) return { ready: false, reason: 'Add the approved document template name in Settings > Email & WhatsApp.' };
  if (!PDF_ENGINE_READY) return { ready: false, reason: 'The PDF maker is not switched on yet.' };
  return { ready: true, reason: null };
}

interface Doc {
  storeId: string;
  no: string;
  customerName: string;
  phone: string | null;
  org: string;
  /** The no-login page path, e.g. /i/<token>. */
  path: string;
}

const KIND: Record<SendDocType, { doc: DocKind; label: string; prefix: string }> = {
  invoice: { doc: 'invoice', label: 'Invoice', prefix: '/i' },
  quotation: { doc: 'quotation', label: 'Quotation', prefix: '/q' },
  order: { doc: 'order', label: 'Sales order', prefix: '/o' },
};

async function loadDoc(ctx: AppContext, type: SendDocType, id: string): Promise<Doc> {
  const scope = ctx.scope;
  const { guardSalesDocOrThrow } = await import('./sales-reach');
  if (type === 'invoice') {
    const { getInvoiceDetail, ensureInvoiceShareToken } = await import('./invoices');
    const d = await getInvoiceDetail(scope, id);
    if (!d) throw new SendError('Invoice not found in your branch.');
    await guardSalesDocOrThrow(ctx, d.salespersonId);
    const token = await ensureInvoiceShareToken(scope, id);
    return { storeId: storeOf(scope), no: d.invoiceNo, customerName: d.customerName, phone: d.phone, org: d.org.name, path: `/i/${token}` };
  }
  if (type === 'quotation') {
    const { getQuotationDetail, ensureShareToken } = await import('./quotations');
    const d = await getQuotationDetail(scope, id);
    if (!d) throw new SendError('Quotation not found in your branch.');
    await guardSalesDocOrThrow(ctx, d.salespersonId);
    // A quotation reaches the customer only once any approval has passed - the same gate as Mark as Sent.
    const { gateQuotationSend } = await import('./quotation-send-gate');
    const held = await gateQuotationSend(scope, ctx.user.id, id);
    if (held) throw new SendError(held);
    const token = await ensureShareToken(scope, id, false);
    return { storeId: storeOf(scope), no: d.quotationNo, customerName: d.customerName, phone: d.phone, org: d.org.name, path: `/q/${token}` };
  }
  const { getSalesOrderDetail } = await import('./sales-orders');
  const { ensureOrderShareToken } = await import('./customer-links');
  const d = await getSalesOrderDetail(scope, id);
  if (!d) throw new SendError('Order not found in your branch.');
  await guardSalesDocOrThrow(ctx, d.salespersonId);
  const token = await ensureOrderShareToken(scope, id);
  return { storeId: storeOf(scope), no: d.orderNo, customerName: d.customerName, phone: d.phone, org: d.org.name, path: `/o/${token}` };
}

const storeOf = (scope: StoreScope) => scopeForWrite(scope);

/** A refusal worth showing as it is. */
export class SendError extends Error {}

export interface SendOutcome { ok: boolean; status: string; error: string | null; sendId: string }

/**
 * Send the document's PDF to the customer from the branch's WhatsApp number,
 * inside the approved template, and log it. `origin` is the public address
 * WhatsApp downloads the PDF from.
 */
export async function sendDocumentOnWhatsApp(ctx: AppContext, type: SendDocType, id: string, origin: string): Promise<SendOutcome> {
  const doc = await loadDoc(ctx, type, id);
  const state = await whatsappApiState(doc.storeId);
  if (!state.ready) throw new SendError(state.reason ?? 'WhatsApp Business is not ready.');
  if (!doc.phone) throw new SendError('This customer has no mobile number on the document.');

  const row = await db.messagingChannel.findUnique({
    where: { storeId_channel: { storeId: doc.storeId, channel: 'whatsapp' } },
    select: { credentials: true },
  });
  const c = (row?.credentials ?? {}) as Record<string, string>;
  const k = KIND[type];
  const result = await sendOn(doc.storeId, 'whatsapp', { name: doc.customerName, phone: doc.phone }, {
    subject: `${k.label} ${doc.no}`,
    text: docMessage({ kind: k.doc, number: doc.no, customerName: doc.customerName, org: doc.org }),
    templateName: c.docTemplate,
    templateParams: [doc.customerName || 'Customer', `${k.label} ${doc.no}`, doc.org],
    document: { url: `${origin}${doc.path}/pdf`, filename: `${doc.no}.pdf` },
  });

  const now = new Date();
  const row2 = await db.documentSend.create({
    data: {
      storeId: doc.storeId, docType: type, docId: id, docNo: doc.no, channel: 'whatsapp',
      toName: doc.customerName, toPhone: doc.phone, templateName: c.docTemplate ?? null,
      status: result.ok ? 'sent' : 'failed', providerRef: result.providerRef ?? null,
      error: result.ok ? null : (result.error ?? 'WhatsApp refused it.'),
      sentBy: ctx.user.id, sentAt: now, failedAt: result.ok ? null : now,
    },
    select: { id: true },
  });
  return { ok: result.ok, status: result.ok ? 'sent' : 'failed', error: result.ok ? null : (result.error ?? 'WhatsApp refused it.'), sendId: row2.id };
}

export interface SendRow {
  id: string; status: string; toPhone: string; error: string | null;
  sentAt: string; deliveredAt: string | null; readAt: string | null; by: string | null;
}

/** The sends of one document, newest first - for its page. */
export async function documentSends(scope: StoreScope, type: SendDocType, id: string): Promise<SendRow[]> {
  if (scope.kind !== 'single') return [];
  const rows = await db.documentSend.findMany({
    where: { storeId: scope.storeId, docType: type, docId: id },
    orderBy: { sentAt: 'desc' },
    take: 20,
    select: { id: true, status: true, toPhone: true, error: true, sentAt: true, deliveredAt: true, readAt: true, sentBy: true },
  });
  const names = new Map((await db.user.findMany({
    where: { id: { in: rows.map((r) => r.sentBy).filter((x): x is string => !!x) }, storeRoles: { some: { storeId: scope.storeId } } },
    select: { id: true, fullName: true },
  })).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id, status: r.status, toPhone: r.toPhone, error: r.error,
    sentAt: r.sentAt.toISOString(), deliveredAt: r.deliveredAt?.toISOString() ?? null, readAt: r.readAt?.toISOString() ?? null,
    by: r.sentBy ? names.get(r.sentBy) ?? null : null,
  }));
}

/** Everything a document page needs for the WhatsApp Business panel. */
export async function whatsappPanel(scope: StoreScope, type: SendDocType, id: string) {
  const storeId = scope.kind === 'single' ? scope.storeId : null;
  const [state, row, sends] = await Promise.all([
    whatsappApiState(storeId),
    storeId ? db.messagingChannel.findUnique({ where: { storeId_channel: { storeId, channel: 'whatsapp' } }, select: { provider: true } }) : null,
    // The page must open even if the send log cannot be read (a database a
    // migration behind) - the panel then just shows no history.
    documentSends(scope, type, id).catch((e) => { console.error('[document-send] log unreadable', e); return [] as SendRow[]; }),
  ]);
  return { state, configured: row?.provider === 'whatsapp_cloud', sends };
}
