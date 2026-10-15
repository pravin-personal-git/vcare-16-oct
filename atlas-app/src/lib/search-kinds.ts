import type { IconName } from '@/components/ui/Icon';

/**
 * WHAT THE GLOBAL SEARCH CAN FIND, named once.
 *
 * This list, its labels and its icons used to exist TWICE - once in
 * server/search.ts and once again, copied, in components/shell/GlobalSearch.tsx.
 * Two copies of a vocabulary agree only until somebody edits one, and that is
 * exactly what happened: the service module added complaints and challans to
 * the product and neither copy heard about it, so about 10,500 records the
 * client refers to by number every day could not be found at all.
 *
 * So it lives here, in lib, which both the server query and the client palette
 * can import. Adding a kind now means adding it in one place and the compiler
 * requiring the label and the icon, because both maps are `Record<ResultKind, …>`
 * rather than `Record<string, …>` - a missing entry is a build error, not a
 * blank row at runtime.
 */
export type ResultKind =
  | 'customer' | 'supplier' | 'invoice' | 'bill' | 'product' | 'quotation' | 'order'
  | 'lead' | 'creditNote' | 'salesReturn' | 'receipt' | 'purchaseOrder' | 'employee' | 'task'
  | 'complaint' | 'repairChallan' | 'installationChallan' | 'amcContract' | 'stockUnit' | 'replacement'
  | 'pickup' | 'supplierDispatch' | 'rmaReceipt';

export const KIND_LABEL: Record<ResultKind, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  invoice: 'Invoice',
  bill: 'Purchase bill',
  product: 'Product',
  quotation: 'Quotation',
  order: 'Sales order',
  lead: 'Lead',
  creditNote: 'Credit note',
  salesReturn: 'Sales return',
  receipt: 'Receipt',
  purchaseOrder: 'Purchase order',
  employee: 'Employee',
  task: 'Task',
  complaint: 'Complaint',
  repairChallan: 'Repair challan',
  installationChallan: 'Installation challan',
  amcContract: 'AMC contract',
  stockUnit: 'Stock unit',
  replacement: 'Replacement case',
  pickup: 'Pickup receipt',
  supplierDispatch: 'Supplier dispatch',
  rmaReceipt: 'RMA receipt',
};

export const KIND_ICON: Record<ResultKind, IconName> = {
  customer: 'users',
  supplier: 'truck',
  invoice: 'file-text',
  bill: 'receipt',
  product: 'package',
  quotation: 'file-text',
  order: 'shopping-cart',
  lead: 'user-plus',
  creditNote: 'receipt',
  salesReturn: 'rotate-ccw',
  receipt: 'credit-card',
  purchaseOrder: 'shopping-cart',
  employee: 'user',
  task: 'check-circle',
  complaint: 'alert-circle',
  repairChallan: 'truck',
  installationChallan: 'box',
  amcContract: 'refresh',
  stockUnit: 'box',
  replacement: 'rotate-ccw',
  pickup: 'package',
  supplierDispatch: 'truck',
  rmaReceipt: 'download',
};

export interface SearchHit {
  kind: ResultKind;
  id: string;
  /** The thing itself - a name, a document number. */
  title: string;
  /** Context that disambiguates two similar titles. */
  subtitle: string;
  /** Money, status - whatever makes the row decidable at a glance. */
  meta?: string;
  route: string;
}
