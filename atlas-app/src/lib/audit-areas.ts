/**
 * Which AREA of the business an audit event belongs to (Stage G, 3 Oct 2026).
 *
 * The activity log could already be filtered by "record type", which is a list
 * of seventy database table names - "Installation challan assignee", "Role menu
 * config". Nobody opens the log thinking in tables. They open it thinking
 * "something is wrong with the money" or "who changed the settings", so the
 * first filter is the area, and the table filter stays for the narrow cases.
 *
 * The spec names four areas: money, stock, people, settings. A fifth is
 * needed and added openly: on Vcare's own log, complaints, challans and lead
 * notes are more than half of everything recorded, and they are none of the
 * four. Forcing them into "people" would make the busiest area meaningless.
 *
 * EVERY audited table is listed explicitly. `audit-areas.test.ts` reads the
 * tables the audit trigger covers and fails when one has no area, so a new
 * table cannot quietly land in nowhere - the same rule the settings registry
 * applies to settings screens.
 */

export const AUDIT_AREAS = ['money', 'stock', 'sales', 'people', 'settings'] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

export const AREA_LABEL: Record<AuditArea, string> = {
  money: 'Money',
  stock: 'Stock & buying',
  sales: 'Sales & service',
  people: 'People',
  settings: 'Settings',
};

export const AREA_HINT: Record<AuditArea, string> = {
  money: 'Invoices, receipts, payments, the ledger, tax and number series.',
  stock: 'Products, prices, stock movements, purchase orders and goods received.',
  sales: 'Leads, quotations, orders, complaints, challans, visits and the shop.',
  people: 'Staff, attendance, leave, payroll, tasks and the common hub.',
  settings: 'Roles, menus, permissions, templates and configuration.',
};

const AREA_TABLES: Record<AuditArea, readonly string[]> = {
  money: [
    'Account', 'AccountingPeriod', 'BankAccount', 'BankTransaction', 'CreditNote', 'CreditNoteAllocation',
    'CreditNoteItem', 'DocumentNumberAllocation', 'DocumentSend', 'FinancialYear', 'Invoice', 'InvoiceItem', 'InvoiceItemSource',
    'InvoicePayment', 'InvoiceRevision', 'InvoiceSource', 'JobOfflineReceipt', 'JournalEntry', 'JournalLine',
    'OpeningBalance', 'PaymentType', 'PolicyRenewalPayment', 'PurchaseBill', 'PurchaseBillItem', 'Receipt',
    'ReceiptAllocation', 'Refund', 'StaffLoan', 'StaffLoanRepayment', 'StaffTransaction', 'SupplierDebitNote',
    'SupplierPayment', 'SupplierPaymentAllocation', 'TaxRate', 'TaxType', 'Transaction',
  ],
  stock: [
    'BillOfMaterials', 'BomComponent', 'Brand', 'Category', 'Courier', 'FaultyPartReturn', 'GoodsReceiptNote',
    'GoodsReceiptNoteItem', 'MaterialIssue', 'Product', 'ProductPrice', 'ProductPurchasePrice', 'ProductionOrder',
    'PurchaseOrder', 'PurchaseOrderItem', 'PurchaseReturn', 'PurchaseReturnItem', 'StockLot', 'StockMovement',
    'StockUnit', 'Warehouse',
  ],
  sales: [
    'PhoneOp',
    'AmcContract', 'AmcContractItem', 'Cart', 'CartItem', 'CatalogueCombo', 'CatalogueComboItem', 'CatalogueEvent',
    'CatalogueImage', 'CatalogueListing', 'ProductReview', 'ShopWishlist', 'Complaint', 'ComplaintItem', 'ItemPickup', 'SupplierDispatch', 'RmaReceipt', 'CustomerType', 'InstallationChallan',
    'InstallationChallanAssignee', 'InstallationChallanItem', 'JobChallan', 'JobChallanLine', 'JobEstimate', 'JobOtp',
    'Lead', 'LeadDealStage', 'LeadNote', 'LeadPolicy', 'LeadSource', 'LeadStage', 'LeadTag', 'Party', 'PartySite',
    'PolicyRenewal', 'Quotation', 'QuotationItem', 'RepairChallan', 'ReplacementCase', 'SalesOrder', 'SalesOrderItem',
    'SalesReturn', 'SalesReturnItem', 'ServiceVisit', 'SiteOverride', 'StepRequest', 'Task', 'UserTarget',
    'VisitChange',
  ],
  people: [
    'ApprovalRequest', 'Asset', 'AssetBatch', 'AssetRequest', 'AttendanceDay', 'AttendanceDevice',
    'AttendanceCodeMap', 'AttendanceMarkPolicy', 'AttendancePhoto', 'AttendancePolicy', 'AttendancePunch', 'AttendanceSession',
    'AttendanceZone', 'Candidate', 'CompOffEntry', 'Department', 'DisciplinaryAction', 'DisciplinaryActionType',
    'DocumentAttachment', 'EmployeeAttendanceRule', 'EmployeeProfile', 'EmployeeSalary', 'EmployeeShift',
    'EmployeeShiftSchedule', 'EmployeeTag', 'EmployeeTypeTag', 'HelpdeskCategory', 'HelpdeskComment', 'HelpdeskFaq',
    'HelpdeskFaqCategory', 'HelpdeskTicket', 'Holiday', 'IncomeTaxDeclaration', 'InternalPolicy',
    'InterviewInterviewer', 'InterviewSchedule', 'JobOpening', 'LeaveAllocation', 'LeaveAllocationRequest',
    'LeaveEncashment', 'LeaveRequest', 'LeaveType', 'LifecycleChecklistItem', 'LifecycleTask', 'LinkedAccount',
    'Membership', 'Message', 'Notice', 'Notification', 'NotificationDelivery', 'PayrollConfiguration', 'PayrollRun',
    'Payslip', 'PayslipLine', 'PersonalReminder', 'PolicyAcknowledgement', 'Project', 'ProjectManager',
    'ProjectStage', 'ProjectTask', 'ProjectTaskManager', 'ProjectTaskMember', 'ProjectTimesheet', 'PushToken',
    'ReimbursementClaim', 'ReportingAssignment', 'Resignation', 'RestrictedLeavePeriod', 'SalaryComponent',
    'SalaryComponentCondition', 'SalaryContract', 'SharedFile', 'SkillZone', 'SkillZoneCandidate',
    'StaffChecklistEntry', 'StaffChecklistItem', 'User', 'WorkType',
  ],
  settings: [
    'ApiToken', 'ApprovalChain', 'ApprovalRule', 'ApprovalRuleLevel', 'ComplaintFieldConfig', 'DocumentTemplate',
    'EntityFieldConfig', 'ImpersonationSession', 'IncentiveSettings', 'JobSettings', 'LegalEntity', 'TravelSettings',
    'MessagingChannel', 'NotificationSetting', 'NumberBlock', 'Organization', 'PlatformAccount', 'PlatformRole',
    'PlatformRolePermission', 'Role', 'RoleAppAccess', 'RoleConfig', 'RoleMenuConfig', 'RolePermission',
    'SavedView', 'StockFieldConfig', 'Store', 'StoreConfig', 'StoreMenuConfig', 'TncTemplate', 'UserAppAccess',
    'UiCustomisation', 'UserConfig', 'UserMenuConfig', 'UserStoreRole',
  ],
};

const TABLE_AREA = new Map<string, AuditArea>(
  AUDIT_AREAS.flatMap((a) => AREA_TABLES[a].map((t) => [t, a] as const)),
);

/** The area a table's events belong to, or null for a table nobody has placed yet. */
export const areaOf = (table: string): AuditArea | null => TABLE_AREA.get(table) ?? null;

export const tablesInArea = (area: AuditArea): readonly string[] => AREA_TABLES[area];

export const isAuditArea = (v: unknown): v is AuditArea =>
  typeof v === 'string' && (AUDIT_AREAS as readonly string[]).includes(v);

/** Every table placed in some area - for the coverage test. */
export const PLACED_TABLES: readonly string[] = [...TABLE_AREA.keys()];
