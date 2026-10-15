/**
 * Who may change the files on each kind of document. Attaching, tagging,
 * replacing or removing a file is editing that document, so each type uses
 * its own edit right. Shared by the upload route and the per-file actions
 * (11 Oct 2026) so the two can never disagree.
 */
export const ATTACHABLE = [
  'quotation', 'sales_order', 'invoice', 'goods_receipt', 'lead', 'complaint', 'installation_challan', 'receipt',
] as const;
export type AttachableType = (typeof ATTACHABLE)[number];

export const CAN_ATTACH: Record<AttachableType, string[]> = {
  quotation: ['quotation.edit'],
  sales_order: ['orders.edit'],
  invoice: ['invoice.edit'],
  goods_receipt: ['purchase.edit'],
  lead: ['leads.create', 'leads.edit'],
  /**
   * Job photos (3 Oct 2026). `complaints.edit` rather than a new permission,
   * because the technician who took the photo is the person already allowed to
   * update the job - a separate right would mean every client reconfiguring roles
   * before their technicians could add a single photo.
   */
  complaint: ['complaints.edit'],
  // Site photos on an installation (11 Oct 2026) - whoever may work on it.
  installation_challan: ['installations.edit'],
  // Payment proof on a receipt (11 Oct 2026) - whoever may record receipts.
  receipt: ['accounts.edit'],
};

export function canAttach(permissions: Set<string>, docType: string): boolean {
  return (ATTACHABLE as readonly string[]).includes(docType)
    && CAN_ATTACH[docType as AttachableType].some((p) => permissions.has(p));
}
