-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loginLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "storeId" TEXT,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorKind" TEXT,
    "via" TEXT,
    "ip" TEXT,
    "changed" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_storeId_createdAt_idx" ON "AuditEvent"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tableName_rowId_idx" ON "AuditEvent"("tableName", "rowId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");


-- The audit trigger (health check AUD-1). Records every insert, update and
-- delete on the tables below into "AuditEvent", in the same transaction as the
-- change. The actor is the transaction-local setting app.actor, set by the
-- database client (src/server/db.ts); without it the event is "system".
CREATE OR REPLACE FUNCTION atlas_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  actor jsonb;
  old_j jsonb;
  new_j jsonb;
  row_j jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
  skip text[] := ARRAY['updatedAt','lastLoginAt','lastSyncedAt','lastCallAt','lastActiveAt','lastSeenAt',
    'failedLoginCount','portalFailedLogins','loginLockedUntil','portalLockedUntil'];
  secret text[] := ARRAY['codeHash','contentHash','passwordHash','portalPasswordHash','publicToken','pushToken','sessionToken','token','tokenHash']::text[];
BEGIN
  BEGIN
    actor := NULLIF(current_setting('app.actor', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;
  IF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      CONTINUE WHEN k = ANY(skip);
      IF old_j -> k IS DISTINCT FROM new_j -> k THEN
        IF k = ANY(secret) THEN
          diff := diff || jsonb_build_object(k, jsonb_build_array('(hidden)', '(changed)'));
        ELSE
          diff := diff || jsonb_build_object(k, jsonb_build_array(old_j -> k, new_j -> k));
        END IF;
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
    row_j := new_j;
  ELSIF TG_OP = 'INSERT' THEN
    row_j := to_jsonb(NEW);
    diff := row_j - secret;
  ELSE
    row_j := to_jsonb(OLD);
    diff := row_j - secret;
  END IF;
  INSERT INTO "AuditEvent" ("storeId","tableName","rowId","action","actorId","actorName","actorKind","via","ip","changed")
  VALUES (
    COALESCE(row_j ->> 'storeId', actor ->> 'storeId'),
    TG_TABLE_NAME, row_j ->> 'id', lower(TG_OP),
    actor ->> 'id', actor ->> 'name', COALESCE(actor ->> 'kind', 'system'), actor ->> 'via', actor ->> 'ip',
    diff
  );
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS atlas_audit ON "PlatformAccount";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PlatformAccount" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Organization";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Organization" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LegalEntity";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LegalEntity" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ApiToken";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ApiToken" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Store";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Store" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "User";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ReportingAssignment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ReportingAssignment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Role";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Role" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PlatformRole";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PlatformRole" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PlatformRolePermission";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PlatformRolePermission" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Membership";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "RolePermission";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RolePermission" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "UserStoreRole";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserStoreRole" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ImpersonationSession";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ImpersonationSession" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StoreMenuConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StoreMenuConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "RoleMenuConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RoleMenuConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "UserMenuConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserMenuConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Department";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Department" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "FinancialYear";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "FinancialYear" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "TaxType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "TaxType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "TaxRate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "TaxRate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PaymentType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PaymentType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ApprovalChain";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ApprovalChain" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ApprovalRequest";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Category";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Category" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Brand";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Brand" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Warehouse";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Product";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProductPurchasePrice";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductPurchasePrice" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProductPrice";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductPrice" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CustomerType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CustomerType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Party";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Party" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadStage";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadStage" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadSource";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadSource" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadDealStage";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadDealStage" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Lead";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Lead" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadTag";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadTag" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadNote";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadNote" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeadPolicy";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeadPolicy" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "TncTemplate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "TncTemplate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "BankAccount";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "BankAccount" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "BankTransaction";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "BankTransaction" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Courier";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Courier" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Notice";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Notice" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InternalPolicy";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InternalPolicy" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PolicyAcknowledgement";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PolicyAcknowledgement" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "DisciplinaryActionType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DisciplinaryActionType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "DisciplinaryAction";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DisciplinaryAction" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Message";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Message" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AssetBatch";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AssetBatch" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Asset";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Asset" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AssetRequest";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AssetRequest" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "HelpdeskCategory";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "HelpdeskCategory" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "HelpdeskTicket";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "HelpdeskTicket" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "HelpdeskComment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "HelpdeskComment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "HelpdeskFaqCategory";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "HelpdeskFaqCategory" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "HelpdeskFaq";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "HelpdeskFaq" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "JobOpening";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobOpening" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Candidate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Candidate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InterviewSchedule";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InterviewSchedule" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InterviewInterviewer";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InterviewInterviewer" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SkillZone";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SkillZone" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SkillZoneCandidate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SkillZoneCandidate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LifecycleChecklistItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LifecycleChecklistItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LifecycleTask";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LifecycleTask" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeProfile";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeProfile" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeTypeTag";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeTypeTag" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeTag";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeTag" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "WorkType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "WorkType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeShift";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeShift" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeShiftSchedule";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeShiftSchedule" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Resignation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Resignation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Task";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Project";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Project" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectManager";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectManager" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectStage";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectStage" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectTask";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectTask" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectTaskManager";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectTaskManager" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectTaskMember";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectTaskMember" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProjectTimesheet";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProjectTimesheet" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ComplaintFieldConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ComplaintFieldConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Complaint";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Complaint" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ServiceVisit";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "RepairChallan";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RepairChallan" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InstallationChallan";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InstallationChallan" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InstallationChallanItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InstallationChallanItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AmcContract";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AmcContract" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AmcContractItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AmcContractItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InstallationChallanAssignee";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InstallationChallanAssignee" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PolicyRenewal";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PolicyRenewal" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Quotation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Quotation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "QuotationItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "QuotationItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalesOrder";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalesOrderItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalesOrderItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Invoice";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InvoiceItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InvoicePayment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InvoicePayment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Receipt";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Receipt" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ReceiptAllocation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ReceiptAllocation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StockMovement";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "UserTarget";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserTarget" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "DocumentAttachment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DocumentAttachment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SharedFile";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SharedFile" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "InvoiceRevision";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InvoiceRevision" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalesReturn";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalesReturn" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalesReturnItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalesReturnItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CreditNote";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CreditNoteItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CreditNoteItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CreditNoteAllocation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CreditNoteAllocation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Refund";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceSession";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceSession" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceDay";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceDay" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseBill";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseBill" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseBillItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseBillItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "GoodsReceiptNote";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "GoodsReceiptNote" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "GoodsReceiptNoteItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "GoodsReceiptNoteItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StockLot";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StockLot" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StockUnit";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StockUnit" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StockFieldConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StockFieldConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseOrder";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseOrderItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseOrderItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Account";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Account" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "JournalEntry";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "JournalLine";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AccountingPeriod";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AccountingPeriod" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SupplierPayment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SupplierPayment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SupplierPaymentAllocation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SupplierPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StaffTransaction";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StaffTransaction" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseReturn";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseReturn" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PurchaseReturnItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PurchaseReturnItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SupplierDebitNote";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SupplierDebitNote" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Transaction";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Transaction" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "BillOfMaterials";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "BillOfMaterials" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "BomComponent";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "BomComponent" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ProductionOrder";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductionOrder" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeSalary";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeSalary" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LinkedAccount";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LinkedAccount" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Holiday";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Holiday" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeaveRequest";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeaveType";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeaveType" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeaveAllocation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeaveAllocation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeaveAllocationRequest";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeaveAllocationRequest" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "RestrictedLeavePeriod";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RestrictedLeavePeriod" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CompOffEntry";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CompOffEntry" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalaryContract";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalaryContract" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalaryComponent";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalaryComponent" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "SalaryComponentCondition";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "SalaryComponentCondition" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PayrollConfiguration";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PayrollConfiguration" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PayrollRun";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PayrollRun" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Payslip";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Payslip" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PayslipLine";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PayslipLine" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StaffLoan";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StaffLoan" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StaffLoanRepayment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StaffLoanRepayment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "LeaveEncashment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "LeaveEncashment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ReimbursementClaim";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ReimbursementClaim" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "IncomeTaxDeclaration";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "IncomeTaxDeclaration" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "OpeningBalance";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "OpeningBalance" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendancePolicy";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendancePolicy" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceMarkPolicy";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceMarkPolicy" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceZone";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceZone" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "AttendanceDevice";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendanceDevice" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PartySite";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PartySite" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ReplacementCase";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ReplacementCase" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "EmployeeAttendanceRule";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EmployeeAttendanceRule" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
