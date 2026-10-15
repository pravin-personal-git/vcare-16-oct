import AsyncStorage from '@react-native-async-storage/async-storage';
import { authed } from './api';
import { androidId } from './device';
import { send } from './outbox';

/**
 * Sales on the phone (13 Oct 2026, native admin app - ADMIN-NATIVE-APP-SPEC
 * part 2). Reads keep their last copy like everything else (lib/net); new
 * documents and button presses go through the outbox, so they work with no
 * signal and are applied once. Totals on the phone come from the website's
 * own arithmetic (@shared/lib/quotation-totals); the server works them out
 * again from the lines and saves its own.
 */
export interface CatalogueProduct {
  id: string; code: string; name: string; dlpPaise: number; mrpPaise: number; taxRatePct: number;
  hsn: string | null; category: string | null; barcode: string | null; stock: number; promised: number;
}
export interface Buyer {
  id: string; code: string; name: string; company: string | null; phone: string;
  email: string | null; city: string | null; state: string | null; gstin: string | null; address: string | null;
}
export interface LeadPick { id: string; code: string; name: string; company: string | null; phone: string; email: string | null; city: string | null; state: string | null }
export interface Catalogue extends Partial<CatalogueExtra> {
  products: CatalogueProduct[]; buyers: Buyer[]; leads: LeadPick[]; storeStateId: string | null;
  can: { quotation: boolean; order: boolean; invoice: boolean }; at: string;
}
export const salesCatalogue = () => authed<Catalogue>('/api/v1/sales/catalogue');

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'expired';
export interface QuotationRow {
  id: string; quotationNo: string; customerName: string; organizationName: string | null; phone: string;
  quotationDate: string; validUntil: string; grandTotalPaise: number; status: QuotationStatus; itemCount: number;
  salespersonName: string | null; awaitingApproval: boolean;
}
export const quotations = (view: 'active' | 'history' = 'active') =>
  authed<{ quotations: QuotationRow[]; canCreate: boolean }>(`/api/v1/sales/quotations${view === 'history' ? '?view=history' : ''}`);

export interface QuotationDetail {
  id: string; quotationNo: string; status: QuotationStatus; quotationDate: string; validUntil: string;
  partyId: string | null; customerName: string; organizationName: string | null; email: string | null; phone: string;
  gstin: string | null; billingAddress: string | null; shippingAddress: string | null; taxMode: string;
  items: { srNo: number; productName: string; productCode: string | null; qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number; lineTotalPaise: number }[];
  subtotalPaise: number; itemDiscountPaise: number; orderDiscountPaise: number; taxableBasePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; grandTotalPaise: number;
  salespersonName: string | null; notes?: string | null;
}
export const quotation = (id: string) =>
  authed<{ quotation: QuotationDetail; order: { id: string; orderNo: string } | null; can: { edit: boolean; convert: boolean } }>(`/api/v1/sales/quotations/${id}`);

export interface NewLine { productId: string | null; productName: string; productCode: string | null; qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number }
export interface NewQuotation {
  leadId: string | null; partyId: string | null; customerName: string; organizationName: string | null; phone: string;
  email: string | null; gstin: string | null; billingAddress: string | null; stateId: string | null; noGst: boolean;
  discountType: 'amount' | 'percent'; discountValue: number; deliveryPaise: number; validityPeriodDays: number; notes: string | null;
  lines: NewLine[];
}
export const createQuotation = (q: NewQuotation) =>
  send<{ ok: true; id: string; quotationNo: string; message: string }>('/api/v1/sales/quotations', { ...q }, { label: `New quotation: ${q.customerName}`, target: 'quotation:new' });

export const quotationStatus = (id: string, status: 'sent' | 'accepted' | 'rejected') =>
  send<{ ok: true; message: string }>(`/api/v1/sales/quotations/${id}`, { action: 'status', status }, { label: `Quotation ${status}`, target: `quotation:${id}` });

export const quotationToOrder = (id: string) =>
  send<{ ok: true; orderId: string; orderNo: string; message: string }>(`/api/v1/sales/quotations/${id}`, { action: 'convert' }, { label: 'Quotation to order', target: `quotation:${id}` });

/** The customer's link - needs signal (it is made on the server). */
export const quotationLink = (id: string) =>
  authed<{ ok: true; url: string }>(`/api/v1/sales/quotations/${id}`, { method: 'POST', body: JSON.stringify({ action: 'link' }) });

export const STATUS_TONE: Record<QuotationStatus, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral', sent: 'brand', accepted: 'success', rejected: 'danger', converted: 'success', expired: 'warning',
};
export const STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', rejected: 'Rejected', converted: 'Converted to order', expired: 'Expired',
};

// ------------------------------------------------- part 3: invoices, orders, payments (13 Oct 2026)

export interface Seller { name: string; gstin: string | null; email: string | null; mobile: string | null; storeName: string; storeAddress: string | null }
export interface ApprovalRuleLite {
  needsApproval: boolean; thresholdPaise: number | null; maxDiscountPct?: number | null; minMarginPct?: number | null;
  skipRoleIds: string[]; skipUserIds: string[]; levels: { level: number; minAmountPaise: number | null }[];
}
export interface CatalogueExtra { seller: Seller | null; approval: { userId: string; roleIds: string[]; invoiceRule: ApprovalRuleLite | null } }

export interface InvoiceRow {
  id: string; invoiceNo: string; customerName: string; organizationName: string | null; invoiceDate: string; dueDate: string;
  grandTotalPaise: number; amountPaidPaise: number; status: string; lifecycle: 'draft' | 'sent' | 'cancelled'; salespersonName: string | null;
}
export const invoices = (view: 'active' | 'history' = 'active') =>
  authed<{ invoices: InvoiceRow[]; canCreate: boolean }>(`/api/v1/sales/invoices${view === 'history' ? '?view=history' : ''}`);

export interface InvoiceDetail {
  id: string; invoiceNo: string; lifecycle: 'draft' | 'sent' | 'cancelled'; invoiceDate: string; dueDate: string;
  customerName: string; organizationName: string | null; phone: string; gstin: string | null; billingAddress: string | null;
  taxMode: string;
  items: { srNo: number; productName: string; productCode: string | null; qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number; lineTotalPaise: number }[];
  payments: { id: string; amountPaise: number; paidAt: string; method: string }[];
  subtotalPaise: number; itemDiscountPaise: number; orderDiscountPaise: number; taxableBasePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; grandTotalPaise: number; amountPaidPaise: number;
  salespersonName: string | null; org: { name: string; gstin: string | null; email: string | null; mobile: string | null };
  storeName: string; storeAddress: string | null;
}
export const invoice = (id: string) =>
  authed<{ invoice: InvoiceDetail; can: { issue: boolean; payment: boolean } }>(`/api/v1/sales/invoices/${id}`);

export interface NewInvoice extends Omit<NewQuotation, 'leadId' | 'validityPeriodDays'> {
  invoiceDate: string; termsDays: number; newCustomer: boolean;
  /** A final number from this phone's block - or null: numbered by the office (needs approval / none left). */
  invoiceNo: string | null; issue: boolean;
  payment: { amountPaise: number; method: string; reference: string | null } | null;
}
export const createInvoice = (inv: NewInvoice) =>
  send<{ ok: true; id: string; invoiceNo: string; held: boolean; message: string }>('/api/v1/sales/invoices', { ...inv }, {
    label: `Invoice ${inv.invoiceNo ?? '(number from the office)'}: ${inv.customerName}`, target: 'invoice:new',
  });
export const issueInvoice = (id: string) =>
  send<{ ok: true; held: boolean; message: string }>(`/api/v1/sales/invoices/${id}`, { action: 'issue' }, { label: 'Issue invoice', target: `invoice:${id}` });
export const invoicePayment = (id: string, p: { amountPaise: number; method: string; reference: string | null }) =>
  send<{ ok: true; message: string; duePaise: number }>(`/api/v1/sales/invoices/${id}`, { action: 'payment', ...p }, { label: `Payment Rs ${p.amountPaise / 100}`, target: `invoice:${id}` });
export const invoiceLink = (id: string) =>
  authed<{ ok: true; url: string }>(`/api/v1/sales/invoices/${id}`, { method: 'POST', body: JSON.stringify({ action: 'link' }) });

export interface OrderRow {
  id: string; orderNo: string; customerName: string; organizationName: string | null; orderDate: string;
  grandTotalPaise: number; amountPaidPaise: number; fulfilmentStatus: string; paymentStatus: string; isInvoiced: boolean; salespersonName: string | null;
}
export const orders = (view: 'active' | 'history' = 'active') =>
  authed<{ orders: OrderRow[] }>(`/api/v1/sales/orders${view === 'history' ? '?view=history' : ''}`);
export interface OrderDetail {
  id: string; orderNo: string; quotationNo: string | null; fulfilmentStatus: string; paymentStatus: string; orderDate: string;
  expectedDeliveryDate: string | null; customerName: string; organizationName: string | null; phone: string; gstin: string | null;
  billingAddress: string | null; taxMode: string;
  items: { srNo: number; productName: string; qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number; lineTotalPaise: number }[];
  subtotalPaise: number; itemDiscountPaise: number; orderDiscountPaise: number; taxableBasePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; deliveryCharge: number; grandTotalPaise: number; amountPaidPaise: number;
  salespersonName: string | null;
}
export const order = (id: string) =>
  authed<{ order: OrderDetail; invoice: { id: string; invoiceNo: string } | null; can: { invoice: boolean } }>(`/api/v1/sales/orders/${id}`);
export const orderToInvoice = (id: string, issue: boolean) =>
  send<{ ok: true; invoiceId: string; invoiceNo: string; held: boolean; message: string }>(`/api/v1/sales/orders/${id}`, { action: 'invoice', issue }, { label: 'Order to invoice', target: `order:${id}` });

// ------------------------------------------------- this phone's invoice numbers (F-13 Q3)

const NUMBERS = 'maalik.invoiceNumbers.v1';
const DEVICE = 'maalik.deviceKey.v1';

async function deviceKey(): Promise<string> {
  const a = androidId();
  if (a) return a;
  let k = await AsyncStorage.getItem(DEVICE).catch(() => null);
  if (!k) { k = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; await AsyncStorage.setItem(DEVICE, k).catch(() => undefined); }
  return k;
}

interface HeldNumbers { numbers: string[]; used: string[]; at: string }
const readNumbers = async (): Promise<HeldNumbers> => {
  try { return JSON.parse((await AsyncStorage.getItem(NUMBERS)) ?? '') as HeldNumbers; } catch { return { numbers: [], used: [], at: '' }; }
};

/** While online: ask the office for this phone's block (it tops up when low). Never throws. */
export async function refreshNumbers(): Promise<number> {
  try {
    const r = await authed<{ numbers: string[] }>('/api/v1/sales/numbers', { method: 'POST', body: JSON.stringify({ deviceKey: await deviceKey() }) });
    if (!r) return 0;
    const held = await readNumbers();
    // A number used on this phone but not yet at the office stays used.
    const next: HeldNumbers = { numbers: r.numbers, used: held.used.filter((u) => r.numbers.includes(u)), at: new Date().toISOString() };
    await AsyncStorage.setItem(NUMBERS, JSON.stringify(next));
    return next.numbers.length - next.used.length;
  } catch { return numbersLeft(); }
}

/** The next unused number on this phone, marked used - or null when none are left. */
export async function takeNumber(): Promise<string | null> {
  const held = await readNumbers();
  const n = held.numbers.find((x) => !held.used.includes(x)) ?? null;
  if (n) await AsyncStorage.setItem(NUMBERS, JSON.stringify({ ...held, used: [...held.used, n] }));
  return n;
}
export async function numbersLeft(): Promise<number> {
  const h = await readNumbers();
  return h.numbers.filter((x) => !h.used.includes(x)).length;
}

/** Draft / Paid / Part paid / Unpaid / Overdue, for an invoice row or page. */
export const invoiceTone = (r: Pick<InvoiceRow, 'lifecycle' | 'grandTotalPaise' | 'amountPaidPaise' | 'dueDate'>, now: number): { label: string; tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' } => {
  if (r.lifecycle === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (r.lifecycle === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  const d = Math.max(0, r.grandTotalPaise - r.amountPaidPaise);
  if (d === 0) return { label: 'Paid', tone: 'success' };
  if (Date.parse(r.dueDate) < now) return { label: 'Overdue', tone: 'danger' };
  return { label: r.amountPaidPaise > 0 ? 'Part paid' : 'Unpaid', tone: 'warning' };
};
