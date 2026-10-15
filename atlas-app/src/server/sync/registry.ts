/**
 * WHAT EVERY TABLE IS, FOR SYNC (F2, F2-SYNC-FOUNDATION-SPEC.md §4.1).
 *
 * F3 has to treat two rows differently depending on what kind of thing they
 * are. A stock movement and a customer are both rows; two nodes that each
 * wrote one need opposite handling - the movements are unioned, the customers
 * merged field by field. Nothing in `schema.prisma` says which a table is, and
 * guessing per query is how a sync engine loses data quietly.
 *
 * WHY A FILE AND NOT A TABLE.
 *
 * Same reason as `lib/config-registry.ts`: a table would let a model exist
 * with no class and a class exist for no model, and both are invisible until
 * F3 does the wrong thing. In code, `registry-coverage.test.ts` holds the two
 * sides together and a new model fails the build until somebody classifies it.
 *
 * CLASSIFYING IS JUDGEMENT, NOT MECHANICS.
 *
 * `AttendanceEvent` is a ledger. `AttendanceDay` is a projection OF that
 * ledger. `AttendancePolicy` is config. All three have "attendance" in the
 * name and none of them syncs the same way. Where a call was close, the reason
 * is written beside it - those notes are the point of this file.
 */

export type SyncClass =
  | 'ledger'
  | 'document'
  | 'master'
  | 'config'
  | 'derived'
  | 'local-only';

export const SYNC_CLASS_RULE: Record<SyncClass, string> = {
  ledger: 'Append-only facts. Union on sync; cannot conflict.',
  document: 'A numbered record with a life. First writer owns; a later conflicting edit becomes a conflict record.',
  master: 'Reference data people edit. Field-level last-writer-wins by version, then timestamp; the loser is kept in the audit log.',
  config: 'Settings. Hub wins; nodes receive it read-only.',
  derived: 'A maintained projection of a ledger. Never synced as numbers - recomputed locally after pull.',
  'local-only': 'Belongs to one machine or one browser. Never synced.',
};

/** Classes whose rows carry the sync columns (see §4.2 of the spec). */
export const SYNCED_CLASSES: readonly SyncClass[] = ['ledger', 'document', 'master', 'config'];

export const SYNC_REGISTRY: Record<string, SyncClass> = {
  // ------------------------------------------------------------- ledger
  // Append-only facts. Nothing here is edited after it is written, which is
  // what makes a union safe: two nodes' rows are both true.
  ActivityLog: 'ledger',
  AuditEvent: 'ledger',
  AiScanLog: 'ledger',
  DeviceEvent: 'ledger',
  PrivilegedAccessEvent: 'ledger',
  AttendanceDeviceEvent: 'ledger',
  /// One punch as the machine reported it. Append-only, so a union is safe -
  /// two nodes each holding a punch is two real punches.
  AttendancePunch: 'ledger',
  AttendanceCodeMap: 'master',
  /// A clock-in photo. Append-only evidence - never edited, so a union is safe.
  AttendancePhoto: 'ledger',
  StockMovement: 'ledger',
  StockUnitEvent: 'ledger',
  /// What a product cost on a particular purchase - a historical fact, not a
  /// current price. `ProductPrice` is the editable one and is master.
  ProductPurchasePrice: 'ledger',
  AttendanceEvent: 'ledger',
  AttendanceSession: 'ledger',
  WebPresence: 'ledger',
  CompOffEntry: 'ledger',
  CallLog: 'ledger',
  ComplaintActivity: 'ledger',
  ReplacementEvent: 'ledger',
  VisitChange: 'ledger',
  AssetHistoryEntry: 'ledger',
  /// Allocations are the money ledger: which receipt settled which invoice.
  /// Two nodes each recording a payment against the same invoice is not a
  /// conflict - both payments happened.
  ReceiptAllocation: 'ledger',
  CreditNoteAllocation: 'ledger',
  SupplierPaymentAllocation: 'ledger',
  InvoicePayment: 'ledger',
  JournalLine: 'ledger',
  LeadActivity: 'ledger',
  LeadNote: 'ledger',
  CandidateActivity: 'ledger',
  PayslipLine: 'ledger',
  NotificationDelivery: 'ledger',
  PolicyAcknowledgement: 'ledger',
  StaffLoanRepayment: 'ledger',
  /// A superseded version of a quotation or invoice, kept for the trail.
  InvoiceRevision: 'ledger',
  HelpdeskComment: 'ledger',
  StaffChecklistEntry: 'ledger',
  InterviewInterviewer: 'ledger',
  ProjectTaskMember: 'ledger',
  ProjectManager: 'ledger',
  ProjectTaskManager: 'ledger',
  InstallationChallanAssignee: 'ledger',
  SkillZoneCandidate: 'ledger',
  LifecycleChecklistItem: 'ledger',

  // ----------------------------------------------------------- document
  // Numbered business records, corrected by cancel/credit/reverse rather than
  // by rewriting (AGENTS.md §4). Line-item tables travel with their parent and
  // take the parent's class - splitting them would let a node own half a bill.
  Quotation: 'document',
  QuotationItem: 'document',
  SalesOrder: 'document',
  SalesOrderItem: 'document',
  Invoice: 'document',
  InvoiceItem: 'document',
  // What an invoice billed and where each charge came from. Parts of the
  // invoice, so they travel and merge with it - a source row that reached the
  // hub without its invoice would describe a document nobody has.
  InvoiceSource: 'document',
  // The shop (3 Oct 2026).
  //
  // The listings and combos are MASTER: a shopkeeper decides what is on show
  // and what it is called, the same kind of decision as a price list, and the
  // hub is where that decision is made.
  CatalogueListing: 'master',
  CatalogueImage: 'master',
  CatalogueCombo: 'master',
  CatalogueComboItem: 'master',
  // A basket is a DOCUMENT in the making - it becomes a lead or a complaint,
  // and it belongs to one customer in one store the whole time. Not derived:
  // nothing can recompute what somebody put in their basket.
  Cart: 'document',
  CartItem: 'document',
  // Append-only trail, like every other ledger here. It is never edited, so
  // two nodes can only ever add rows and a merge is a union.
  CatalogueEvent: 'ledger',
  // Shop reviews are edited by the business (approve, hide, reply); a wishlist
  // is a customer's own list (5 Oct 2026).
  ProductReview: 'master',
  ShopWishlist: 'master',
  InvoiceItemSource: 'document',
  Receipt: 'document',
  Refund: 'document',
  CreditNote: 'document',
  CreditNoteItem: 'document',
  SalesReturn: 'document',
  SalesReturnItem: 'document',
  PurchaseOrder: 'document',
  PurchaseOrderItem: 'document',
  PurchaseBill: 'document',
  PurchaseBillItem: 'document',
  GoodsReceiptNote: 'document',
  GoodsReceiptNoteItem: 'document',
  PurchaseReturn: 'document',
  PurchaseReturnItem: 'document',
  SupplierDebitNote: 'document',
  SupplierPayment: 'document',
  Complaint: 'document',
  ServiceVisit: 'document',
  RepairChallan: 'document',
  InstallationChallan: 'document',
  InstallationChallanItem: 'document',
  JobChallan: 'document',
  JobChallanLine: 'document',
  JobEstimate: 'document',
  JobOfflineReceipt: 'document',
  PhoneOp: 'document',
  FaultyPartReturn: 'document',
  /// A numbered GDN (`gdnNo`), not merely the event of issuing one.
  MaterialIssue: 'document',
  SiteOverride: 'document',
  ReplacementCase: 'document',
  ComplaintItem: 'document',
  ItemPickup: 'document',
  SupplierDispatch: 'document',
  RmaReceipt: 'document',
  // A3 (12 Oct 2026): a document sent on WhatsApp and its delivery state.
  DocumentSend: 'document',
  AmcContract: 'document',
  AmcContractItem: 'document',
  Transaction: 'document',
  JournalEntry: 'document',
  StaffTransaction: 'document',
  BankTransaction: 'document',
  Task: 'document',
  Lead: 'document',
  HelpdeskTicket: 'document',
  LeaveRequest: 'document',
  LeaveAllocationRequest: 'document',
  LeaveAllocation: 'document',
  LeaveEncashment: 'document',
  ReimbursementClaim: 'document',
  Resignation: 'document',
  AssetRequest: 'document',
  DisciplinaryAction: 'document',
  ApprovalRequest: 'document',
  ApprovalChain: 'document',
  PayrollRun: 'document',
  Payslip: 'document',
  StaffLoan: 'document',
  ProductionOrder: 'document',
  PolicyRenewal: 'document',
  PolicyRenewalPayment: 'document',
  StepRequest: 'document',
  InterviewSchedule: 'document',
  Candidate: 'document',
  JobOpening: 'document',
  Project: 'document',
  ProjectStage: 'document',
  ProjectTask: 'document',
  ProjectTimesheet: 'document',
  IncomeTaxDeclaration: 'document',
  OpeningBalance: 'document',
  DocumentAttachment: 'document',
  Message: 'document',
  Notice: 'document',
  SharedFile: 'document',
  Notification: 'document',
  PersonalReminder: 'document',

  // ------------------------------------------------------------- master
  // Reference data people edit, where two offices editing the same row is
  // ordinary rather than exceptional.
  Party: 'master',
  PartySite: 'master',
  Product: 'master',
  ProductPrice: 'master',
  Category: 'master',
  Brand: 'master',
  Warehouse: 'master',
  StockUnit: 'master',
  StockLot: 'master',
  Asset: 'master',
  AssetBatch: 'master',
  User: 'master',
  EmployeeProfile: 'master',
  EmployeeSalary: 'master',
  SalaryContract: 'master',
  EmployeeShift: 'master',
  EmployeeShiftSchedule: 'master',
  EmployeeTag: 'master',
  EmployeeTypeTag: 'master',
  WorkType: 'master',
  Department: 'master',
  Courier: 'master',
  TaxRate: 'master',
  TaxType: 'master',
  PaymentType: 'master',
  CustomerType: 'master',
  Account: 'master',
  BankAccount: 'master',
  LegalEntity: 'master',
  LeadSource: 'master',
  LeadStage: 'master',
  LeadDealStage: 'master',
  LeadTag: 'master',
  LeaveType: 'master',
  SalaryComponent: 'master',
  SalaryComponentCondition: 'master',
  DisciplinaryActionType: 'master',
  HelpdeskCategory: 'master',
  HelpdeskFaq: 'master',
  HelpdeskFaqCategory: 'master',
  InternalPolicy: 'master',
  SkillZone: 'master',
  TncTemplate: 'master',
  BillOfMaterials: 'master',
  BomComponent: 'master',
  GovernmentHoliday: 'master',
  Holiday: 'master',
  RestrictedLeavePeriod: 'master',
  AttendanceZone: 'master',
  StaffChecklistItem: 'master',
  ReportingAssignment: 'master',
  UserStoreRole: 'master',
  UserTarget: 'master',
  Store: 'master',
  Organization: 'master',
  Membership: 'master',

  // ------------------------------------------------------------- config
  // Settings. D1 excludes them from offline entry, so nodes receive them
  // read-only and the hub always wins.
  StoreConfig: 'config',
  // Page customisation an admin set (11 Oct 2026) - settings, hub wins.
  UiCustomisation: 'config',
  RoleConfig: 'config',
  UserConfig: 'config',
  RoleAppAccess: 'config',
  UserAppAccess: 'config',
  AttendancePolicy: 'config',
  AttendanceMarkPolicy: 'config',
  EmployeeAttendanceRule: 'config',
  IncentiveSettings: 'config',
  TravelSettings: 'config',
  DocumentTemplate: 'config',
  MessagingChannel: 'config',
  JobSettings: 'config',
  LeadPolicy: 'config',
  PayrollConfiguration: 'config',
  AccountingPeriod: 'config',
  FinancialYear: 'config',
  ApprovalRule: 'config',
  ApprovalRuleLevel: 'config',
  NotificationSetting: 'config',
  ComplaintFieldConfig: 'config',
  StockFieldConfig: 'config',
  EntityFieldConfig: 'config',
  Menu: 'config',
  StoreMenuConfig: 'config',
  RoleMenuConfig: 'config',
  UserMenuConfig: 'config',
  Role: 'config',
  Permission: 'config',
  RolePermission: 'config',

  // ------------------------------------------------------------ derived
  /**
   * NOT IN THE ORIGINAL FIVE CLASSES, AND ADDED ON PURPOSE (30 Sep).
   *
   * The plan says derived data "is recomputed locally from ledgers after pull
   * - never synced as numbers". That is neither `local-only` (these are
   * store-scoped business data, not one machine's state) nor `ledger` (they
   * are mutated, not appended). Forcing them into either would lose the one
   * instruction F3 actually needs: after a pull, RECOMPUTE these.
   *
   * Syncing them would also conflict constantly and for no reason - two nodes
   * both selling stock both change the same balance, and the correct answer is
   * neither node's number but the sum of the movements underneath.
   */
  ProductBalance: 'derived',
  AttendanceDay: 'derived',

  // --------------------------------------------------------- local-only
  // One machine, one browser, or one session. Never leaves.
  LoginSession: 'local-only',
  // A sealed password (9 Oct 2026). Sealed with this deployment's own key,
  // so a copy on another node could not be opened anyway - and a password
  // should travel nowhere it does not have to.
  UserPasswordCopy: 'local-only',
  PartyLoginSession: 'local-only',
  ImpersonationSession: 'local-only',
  OtpCode: 'local-only',
  MobileRefreshToken: 'local-only',
  MobileWebHandoff: 'local-only',
  PartyRefreshToken: 'local-only',
  PushToken: 'local-only',
  ApiToken: 'local-only',
  CallSyncDevice: 'local-only',
  AttendanceDevice: 'local-only',
  JobOtp: 'local-only',
  LinkedAccount: 'local-only',
  /**
   * A saved list layout is a per-person convenience. Syncing it means conflict
   * resolution on something nobody would notice was lost - and it is per
   * browser anyway, since the hidden-columns half lives in localStorage. If
   * this proves wrong it becomes `master`, which is a one-line change.
   */
  SavedView: 'local-only',
  /**
   * The hub's allocator. A node never touches it - it issues from its own
   * `NumberBlock` - so replicating it would create two authorities for what
   * has been handed out, which is the exact failure number blocks prevent.
   */
  DocumentSequence: 'local-only',
  /** Issued to one node, by definition. */
  NumberBlock: 'local-only',
  /**
   * Which numbers THIS machine handed out, and whether anything claimed them.
   *
   * `local-only` for the same reason as `DocumentSequence`: a node issues from
   * its own `NumberBlock`, so its allocations describe its own block and nobody
   * else's. Replicating them would let one node reissue a number another node
   * had already burnt - the precise failure number blocks exist to prevent.
   *
   * The consequence to accept: the burnt-number report is per machine, which is
   * correct. A gap in a node's own block is a gap in that node's series.
   */
  DocumentNumberAllocation: 'local-only',

  /**
   * Fleet and platform tables. These live on OUR deployment, not a client's,
   * so they are never part of a client's sync. Classed rather than exempted so
   * the coverage test stays honest and a new fleet table still has to be
   * thought about.
   */
  PlatformAccount: 'local-only',
  PlatformConfig: 'local-only',
  PlatformRole: 'local-only',
  PlatformRolePermission: 'local-only',
  LifecycleTask: 'local-only',
};

export const syncClassOf = (model: string): SyncClass | undefined => SYNC_REGISTRY[model];

export const modelsOfClass = (c: SyncClass): string[] =>
  Object.keys(SYNC_REGISTRY).filter((m) => SYNC_REGISTRY[m] === c).sort();

/** True when rows of this model carry `version` / `originNodeId` / tombstones. */
export const carriesSyncColumns = (model: string): boolean => {
  const c = syncClassOf(model);
  return c !== undefined && (SYNCED_CLASSES as readonly string[]).includes(c);
};
