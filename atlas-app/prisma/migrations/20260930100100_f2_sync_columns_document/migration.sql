-- F2 sync columns: document tables (76) - F2-SYNC-FOUNDATION-SPEC.md §4.2, §4.5.
--
-- Numbered records. First writer owns; a later conflicting edit becomes a conflict record for an admin (F3).
--
-- One migration PER CLASS, not one for all 198, so a failure is diagnosable
-- and re-runnable rather than an all-or-nothing on the whole schema.
--
-- Safe on a large table: Postgres 11+ adds a column with a constant default
-- as a metadata change, without rewriting the table.
--
-- updatedAt is backfilled from createdAt where one exists, and only from
-- CURRENT_TIMESTAMP where it does not. A blanket now() would make every
-- historical row look edited on the day of the migration.

ALTER TABLE "AmcContract" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AmcContract" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AmcContract" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AmcContract" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AmcContract_deletedAt_idx" ON "AmcContract"("deletedAt");

ALTER TABLE "AmcContractItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AmcContractItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AmcContractItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AmcContractItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AmcContractItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AmcContractItem" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "AmcContractItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AmcContractItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AmcContractItem_deletedAt_idx" ON "AmcContractItem"("deletedAt");

ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ApprovalChain" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ApprovalChain" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ApprovalChain" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ApprovalChain" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ApprovalChain_deletedAt_idx" ON "ApprovalChain"("deletedAt");

ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ApprovalRequest" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ApprovalRequest_deletedAt_idx" ON "ApprovalRequest"("deletedAt");

ALTER TABLE "AssetRequest" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AssetRequest" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AssetRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AssetRequest" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AssetRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AssetRequest" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "AssetRequest" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AssetRequest" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AssetRequest_deletedAt_idx" ON "AssetRequest"("deletedAt");

ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "BankTransaction" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "BankTransaction" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "BankTransaction" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "BankTransaction_deletedAt_idx" ON "BankTransaction"("deletedAt");

ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Candidate" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Candidate" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Candidate" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Candidate_deletedAt_idx" ON "Candidate"("deletedAt");

ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Complaint_deletedAt_idx" ON "Complaint"("deletedAt");

ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "CreditNote_deletedAt_idx" ON "CreditNote"("deletedAt");

ALTER TABLE "CreditNoteItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CreditNoteItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CreditNoteItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CreditNoteItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "CreditNoteItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CreditNoteItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "CreditNoteItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "CreditNoteItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "CreditNoteItem_deletedAt_idx" ON "CreditNoteItem"("deletedAt");

ALTER TABLE "DisciplinaryAction" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DisciplinaryAction" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "DisciplinaryAction" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "DisciplinaryAction" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "DisciplinaryAction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "DisciplinaryAction" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "DisciplinaryAction" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "DisciplinaryAction" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "DisciplinaryAction_deletedAt_idx" ON "DisciplinaryAction"("deletedAt");

ALTER TABLE "DocumentAttachment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DocumentAttachment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "DocumentAttachment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "DocumentAttachment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "DocumentAttachment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "DocumentAttachment" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "DocumentAttachment" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "DocumentAttachment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "DocumentAttachment_deletedAt_idx" ON "DocumentAttachment"("deletedAt");

ALTER TABLE "FaultyPartReturn" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FaultyPartReturn" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "FaultyPartReturn" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "FaultyPartReturn" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "FaultyPartReturn" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "FaultyPartReturn" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "FaultyPartReturn" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "FaultyPartReturn" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "FaultyPartReturn_deletedAt_idx" ON "FaultyPartReturn"("deletedAt");

ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_deletedAt_idx" ON "GoodsReceiptNote"("deletedAt");

ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "GoodsReceiptNoteItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "GoodsReceiptNoteItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "GoodsReceiptNoteItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "GoodsReceiptNoteItem_deletedAt_idx" ON "GoodsReceiptNoteItem"("deletedAt");

ALTER TABLE "HelpdeskTicket" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "HelpdeskTicket" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "HelpdeskTicket" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "HelpdeskTicket" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "HelpdeskTicket_deletedAt_idx" ON "HelpdeskTicket"("deletedAt");

ALTER TABLE "IncomeTaxDeclaration" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "IncomeTaxDeclaration" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "IncomeTaxDeclaration" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "IncomeTaxDeclaration" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "IncomeTaxDeclaration_deletedAt_idx" ON "IncomeTaxDeclaration"("deletedAt");

ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InstallationChallan" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "InstallationChallan_deletedAt_idx" ON "InstallationChallan"("deletedAt");

ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InstallationChallanItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InstallationChallanItem" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "InstallationChallanItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InstallationChallanItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InstallationChallanItem_deletedAt_idx" ON "InstallationChallanItem"("deletedAt");

ALTER TABLE "InterviewSchedule" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InterviewSchedule" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InterviewSchedule" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InterviewSchedule" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "InterviewSchedule_deletedAt_idx" ON "InterviewSchedule"("deletedAt");

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InvoiceItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "InvoiceItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InvoiceItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InvoiceItem_deletedAt_idx" ON "InvoiceItem"("deletedAt");

ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JobChallan" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JobChallan" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "JobChallan" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JobChallan" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JobChallan_deletedAt_idx" ON "JobChallan"("deletedAt");

ALTER TABLE "JobChallanLine" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobChallanLine" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobChallanLine" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobChallanLine" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JobChallanLine" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JobChallanLine" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "JobChallanLine" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JobChallanLine" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JobChallanLine_deletedAt_idx" ON "JobChallanLine"("deletedAt");

ALTER TABLE "JobEstimate" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobEstimate" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobEstimate" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobEstimate" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JobEstimate" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JobEstimate" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "JobEstimate" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JobEstimate" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JobEstimate_deletedAt_idx" ON "JobEstimate"("deletedAt");

ALTER TABLE "JobOfflineReceipt" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobOfflineReceipt" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobOfflineReceipt" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobOfflineReceipt" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JobOfflineReceipt" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JobOfflineReceipt" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "JobOfflineReceipt" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JobOfflineReceipt" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JobOfflineReceipt_deletedAt_idx" ON "JobOfflineReceipt"("deletedAt");

ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JobOpening" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "JobOpening" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JobOpening" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JobOpening_deletedAt_idx" ON "JobOpening"("deletedAt");

ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JournalEntry" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JournalEntry_deletedAt_idx" ON "JournalEntry"("deletedAt");

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_deletedAt_idx" ON "Lead"("deletedAt");

ALTER TABLE "LeaveAllocation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeaveAllocation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeaveAllocation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveAllocation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "LeaveAllocation_deletedAt_idx" ON "LeaveAllocation"("deletedAt");

ALTER TABLE "LeaveAllocationRequest" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeaveAllocationRequest" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeaveAllocationRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveAllocationRequest" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "LeaveAllocationRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "LeaveAllocationRequest" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "LeaveAllocationRequest" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "LeaveAllocationRequest" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "LeaveAllocationRequest_deletedAt_idx" ON "LeaveAllocationRequest"("deletedAt");

ALTER TABLE "LeaveEncashment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeaveEncashment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeaveEncashment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveEncashment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "LeaveEncashment_deletedAt_idx" ON "LeaveEncashment"("deletedAt");

ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "LeaveRequest_deletedAt_idx" ON "LeaveRequest"("deletedAt");

ALTER TABLE "MaterialIssue" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MaterialIssue" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "MaterialIssue" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "MaterialIssue" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "MaterialIssue" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "MaterialIssue" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "MaterialIssue" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "MaterialIssue" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "MaterialIssue_deletedAt_idx" ON "MaterialIssue"("deletedAt");

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Message" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Message_deletedAt_idx" ON "Message"("deletedAt");

ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Notice_deletedAt_idx" ON "Notice"("deletedAt");

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Notification" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Notification" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Notification_deletedAt_idx" ON "Notification"("deletedAt");

ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "OpeningBalance_deletedAt_idx" ON "OpeningBalance"("deletedAt");

ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollRun_deletedAt_idx" ON "PayrollRun"("deletedAt");

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Payslip_deletedAt_idx" ON "Payslip"("deletedAt");

ALTER TABLE "PersonalReminder" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PersonalReminder" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PersonalReminder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PersonalReminder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PersonalReminder_deletedAt_idx" ON "PersonalReminder"("deletedAt");

ALTER TABLE "PolicyRenewal" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PolicyRenewal" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PolicyRenewal" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PolicyRenewal" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PolicyRenewal_deletedAt_idx" ON "PolicyRenewal"("deletedAt");

ALTER TABLE "PolicyRenewalPayment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PolicyRenewalPayment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PolicyRenewalPayment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PolicyRenewalPayment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PolicyRenewalPayment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PolicyRenewalPayment" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "PolicyRenewalPayment" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PolicyRenewalPayment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PolicyRenewalPayment_deletedAt_idx" ON "PolicyRenewalPayment"("deletedAt");

ALTER TABLE "ProductionOrder" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductionOrder" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProductionOrder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ProductionOrder_deletedAt_idx" ON "ProductionOrder"("deletedAt");

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt");

ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProjectStage" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ProjectStage" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProjectStage" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProjectStage_deletedAt_idx" ON "ProjectStage"("deletedAt");

ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectTask_deletedAt_idx" ON "ProjectTask"("deletedAt");

ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProjectTimesheet" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ProjectTimesheet" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProjectTimesheet" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProjectTimesheet_deletedAt_idx" ON "ProjectTimesheet"("deletedAt");

ALTER TABLE "PurchaseBill" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseBill" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseBill" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseBill" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PurchaseBill_deletedAt_idx" ON "PurchaseBill"("deletedAt");

ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PurchaseBillItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PurchaseBillItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PurchaseBillItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PurchaseBillItem_deletedAt_idx" ON "PurchaseBillItem"("deletedAt");

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PurchaseOrder_deletedAt_idx" ON "PurchaseOrder"("deletedAt");

ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PurchaseOrderItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_deletedAt_idx" ON "PurchaseOrderItem"("deletedAt");

ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PurchaseReturn_deletedAt_idx" ON "PurchaseReturn"("deletedAt");

ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PurchaseReturnItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PurchaseReturnItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PurchaseReturnItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PurchaseReturnItem_deletedAt_idx" ON "PurchaseReturnItem"("deletedAt");

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Quotation_deletedAt_idx" ON "Quotation"("deletedAt");

ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "QuotationItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "QuotationItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "QuotationItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "QuotationItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "QuotationItem_deletedAt_idx" ON "QuotationItem"("deletedAt");

ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Receipt_deletedAt_idx" ON "Receipt"("deletedAt");

ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Refund_deletedAt_idx" ON "Refund"("deletedAt");

ALTER TABLE "ReimbursementClaim" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReimbursementClaim" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ReimbursementClaim" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReimbursementClaim" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ReimbursementClaim_deletedAt_idx" ON "ReimbursementClaim"("deletedAt");

ALTER TABLE "RepairChallan" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RepairChallan" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "RepairChallan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "RepairChallan" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "RepairChallan" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "RepairChallan" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "RepairChallan" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "RepairChallan" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "RepairChallan_deletedAt_idx" ON "RepairChallan"("deletedAt");

ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ReplacementCase_deletedAt_idx" ON "ReplacementCase"("deletedAt");

ALTER TABLE "Resignation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Resignation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Resignation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Resignation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Resignation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Resignation" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Resignation" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Resignation" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Resignation_deletedAt_idx" ON "Resignation"("deletedAt");

ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "SalesOrder_deletedAt_idx" ON "SalesOrder"("deletedAt");

ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SalesOrderItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "SalesOrderItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SalesOrderItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SalesOrderItem_deletedAt_idx" ON "SalesOrderItem"("deletedAt");

ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SalesReturn" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "SalesReturn_deletedAt_idx" ON "SalesReturn"("deletedAt");

ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SalesReturnItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SalesReturnItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "SalesReturnItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SalesReturnItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SalesReturnItem_deletedAt_idx" ON "SalesReturnItem"("deletedAt");

ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ServiceVisit" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ServiceVisit" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ServiceVisit" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ServiceVisit_deletedAt_idx" ON "ServiceVisit"("deletedAt");

ALTER TABLE "SharedFile" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SharedFile" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SharedFile" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SharedFile" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SharedFile" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SharedFile" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "SharedFile" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SharedFile" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SharedFile_deletedAt_idx" ON "SharedFile"("deletedAt");

ALTER TABLE "SiteOverride" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SiteOverride" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SiteOverride" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SiteOverride" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SiteOverride" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SiteOverride" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "SiteOverride" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SiteOverride" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SiteOverride_deletedAt_idx" ON "SiteOverride"("deletedAt");

ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "StaffLoan_deletedAt_idx" ON "StaffLoan"("deletedAt");

ALTER TABLE "StaffTransaction" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffTransaction" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StaffTransaction" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StaffTransaction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StaffTransaction" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "StaffTransaction" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StaffTransaction" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StaffTransaction_deletedAt_idx" ON "StaffTransaction"("deletedAt");

ALTER TABLE "StepRequest" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StepRequest" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StepRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StepRequest" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "StepRequest_deletedAt_idx" ON "StepRequest"("deletedAt");

ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "SupplierDebitNote_deletedAt_idx" ON "SupplierDebitNote"("deletedAt");

ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "SupplierPayment_deletedAt_idx" ON "SupplierPayment"("deletedAt");

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Task_deletedAt_idx" ON "Task"("deletedAt");

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Transaction" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Transaction" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Transaction" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");
