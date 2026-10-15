/**
 * Turning an audit event's raw JSON into sentences people can read - "Rate:
 * ₹500 → ₹50", not `{"ratePaise":[50000,5000]}` (health check AUD-1).
 * Pure, so it is tested without a database.
 */

export interface FieldChange { field: string; from: string | null; to: string | null }

const TABLE_LABEL: Record<string, string> = {
  InvoiceItem: 'Invoice line', QuotationItem: 'Quotation line', SalesOrderItem: 'Sales order line',
  PurchaseBillItem: 'Purchase bill line', PurchaseOrderItem: 'Purchase order line', GoodsReceiptNote: 'Goods receipt',
  GoodsReceiptNoteItem: 'Goods receipt line', InstallationChallan: 'Installation challan',
  InstallationChallanItem: 'Installation challan line', RepairChallan: 'Repair challan', ReplacementCase: 'Replacement case', ComplaintItem: 'Complaint item', ItemPickup: 'Pickup receipt', SupplierDispatch: 'Supplier dispatch', RmaReceipt: 'RMA receipt',
  UserStoreRole: 'Role assignment', RolePermission: 'Role permission', RoleMenuConfig: 'Role menu', StoreMenuConfig: 'Branch menu',
  UserMenuConfig: 'Personal menu', AmcContract: 'AMC contract', AmcContractItem: 'AMC contract item', Party: 'Customer / supplier',
  JournalEntry: 'Journal entry', JournalLine: 'Journal line', StockMovement: 'Stock movement', StockUnit: 'Stock unit',
  AttendanceDay: 'Attendance day', AttendanceSession: 'Attendance session', EmployeeProfile: 'Employee profile',
  EmployeeAttendanceRule: 'Clock-in rule', DocumentAttachment: 'Attachment', SharedFile: 'Shared file',
  ReceiptAllocation: 'Receipt allocation', SupplierPayment: 'Supplier payment', CreditNote: 'Credit note',
  SalesReturn: 'Sales return', PurchaseReturn: 'Purchase return', ServiceVisit: 'Service visit', LeadNote: 'Lead note',
  ReportingAssignment: 'Reporting line', UserTarget: 'Sales target', PaymentType: 'Payment type',
};

export function tableLabel(table: string): string {
  return TABLE_LABEL[table] ?? table.replace(/([a-z])([A-Z])/g, '$1 $2');
}

const HIDDEN = new Set(['id', 'storeId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

/** "ratePaise" → "Rate", "assignedTechnicianId" → "Assigned technician". */
export function fieldLabel(field: string): string {
  const base = field.replace(/Paise$/, '').replace(/Id$/, '').replace(/At$/, '');
  const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatValue(field: string, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (/Paise$/.test(field) && typeof v === 'number') {
    return `₹${(v / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  }
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/**
 * Looks up the name behind an id field ("userId" -> "Deepak"), or undefined to
 * show the value as it is. Optional, so this stays pure and every caller that
 * has no lookups gets exactly the old behaviour.
 */
export type NameOf = (field: string, value: unknown) => string | undefined;

export function describeChange(
  table: string, action: string, changed: Record<string, unknown>, nameOf?: NameOf,
): { summary: string; changes: FieldChange[] } {
  const what = tableLabel(table);
  const show = (k: string, v: unknown) => nameOf?.(k, v) ?? formatValue(k, v);
  if (action === 'update') {
    const changes = Object.entries(changed)
      .filter(([k]) => !HIDDEN.has(k))
      .map(([k, pair]) => {
        const [a, b] = Array.isArray(pair) ? pair : [null, pair];
        return { field: fieldLabel(k), from: show(k, a), to: show(k, b) };
      });
    // A structured value (a JSON blob of settings) is unreadable inline, so
    // the one-line summary only says it changed; Details still shows it whole.
    const structured = (v: string | null) => !!v && /^[[{]/.test(v);
    const first = changes.slice(0, 2).map((c) => (structured(c.from) || structured(c.to)
      ? `${c.field} updated`
      : `${c.field}: ${c.from ?? '(empty)'} → ${c.to ?? '(empty)'}`)).join('; ');
    return {
      summary: `${what} changed - ${first}${changes.length > 2 ? ` and ${changes.length - 2} more` : ''}`,
      changes,
    };
  }
  const changes = Object.entries(changed)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => ({ field: fieldLabel(k), from: action === 'delete' ? show(k, v) : null, to: action === 'delete' ? null : show(k, v) }));
  return { summary: `${what} ${action === 'insert' ? 'created' : 'deleted'}`, changes };
}
