import { authed } from './api';

/**
 * Customers and stock on the phone (13 Oct 2026, native admin app part 4) -
 * the website's customer list and customer page, and Stock on Hand. Read with
 * the last good copy kept (lib/net), so they open offline too.
 */
export interface CustomerRow {
  id: string; code: string; name: string; company: string | null; phone: string; city: string | null; gstin: string | null;
  balancePaise: number; creditLimitPaise: number; lastPurchaseAt: string | null; status: string;
}
export const customers = () => authed<{ customers: CustomerRow[]; totalOwedPaise: number }>('/api/v1/customers');

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';
export type DocType = 'quotation' | 'order' | 'invoice' | 'receipt' | 'credit' | 'return' | 'challan' | 'amc';
export interface CustomerPage {
  customer: {
    id: string; code: string; name: string; company: string | null; phone: string; phoneDial: string; email: string | null;
    gstin: string | null; address: string; since: string | null; creditLimitPaise: number; managerName: string | null;
  };
  figures: {
    lifetimePaise: number; invoiceCount: number; overduePaise: number; oldestDays: number; paidFyPaise: number;
    lastPaymentAt: string | null; openJobs: number; nextVisit: string | null; inWarranty: number;
    activeAmc: { contractNo: string | null; endDate: string } | null;
    aging: { key: string; paise: number; tone: Tone }[];
  };
  docs: { id: string; type: DocType; no: string; at: string; amountPaise: number; duePaise: number | null; status: { label: string; tone: Tone }; note: string }[];
  jobs: { id: string; no: string; at: string; item: string; status: string; tone: Tone; techName: string | null; nextVisit: string | null }[];
  items: { id: string; serial: string; product: string; status: string; warrantyUntil: string | null; amc: boolean; invoiceNo: string | null }[];
  activity: { id: string; kind: string; title: string; detail: string; at: string; byName: string | null }[];
}
export const customerPage = (id: string) => authed<CustomerPage>(`/api/v1/customers/${id}`);

export interface StockRow {
  productId: string; code: string; name: string; unit: string; qty: number; valuePaise?: number;
  category: string | null; brand: string | null; barcode: string | null; negative: boolean; reorderLevel: number; needsReorder: boolean;
}
export const stockOnHand = () =>
  authed<{ rows: StockRow[]; totalValuePaise?: number; outOfStockCount: number; reorderCount: number; negativeCount: number }>('/api/v1/stock/on-hand');
