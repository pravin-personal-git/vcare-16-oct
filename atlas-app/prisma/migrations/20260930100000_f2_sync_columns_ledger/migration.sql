-- F2 sync columns: ledger tables (40) - F2-SYNC-FOUNDATION-SPEC.md §4.2, §4.5.
--
-- Append-only facts. Union on sync, so these can never conflict - but they still need a tombstone, because a row absent from a push and a row deleted on that node must not look the same.
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

ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ActivityLog" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ActivityLog_deletedAt_idx" ON "ActivityLog"("deletedAt");

ALTER TABLE "AiScanLog" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AiScanLog" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AiScanLog" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AiScanLog" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AiScanLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AiScanLog" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "AiScanLog" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AiScanLog" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AiScanLog_deletedAt_idx" ON "AiScanLog"("deletedAt");

ALTER TABLE "AssetHistoryEntry" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AssetHistoryEntry" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AssetHistoryEntry" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AssetHistoryEntry" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AssetHistoryEntry" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AssetHistoryEntry" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "AssetHistoryEntry" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AssetHistoryEntry" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AssetHistoryEntry_deletedAt_idx" ON "AssetHistoryEntry"("deletedAt");

ALTER TABLE "AttendanceDeviceEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AttendanceDeviceEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AttendanceDeviceEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceDeviceEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AttendanceDeviceEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AttendanceDeviceEvent" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "AttendanceDeviceEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AttendanceDeviceEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AttendanceDeviceEvent_deletedAt_idx" ON "AttendanceDeviceEvent"("deletedAt");

ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AttendanceEvent" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "AttendanceEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AttendanceEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AttendanceEvent_deletedAt_idx" ON "AttendanceEvent"("deletedAt");

ALTER TABLE "AttendanceSession" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AttendanceSession" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceSession" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AttendanceSession_deletedAt_idx" ON "AttendanceSession"("deletedAt");

ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AuditEvent" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "AuditEvent_deletedAt_idx" ON "AuditEvent"("deletedAt");

ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CallLog" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "CallLog" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "CallLog" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "CallLog_deletedAt_idx" ON "CallLog"("deletedAt");

ALTER TABLE "CandidateActivity" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CandidateActivity" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CandidateActivity" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CandidateActivity" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "CandidateActivity" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CandidateActivity" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "CandidateActivity" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "CandidateActivity" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "CandidateActivity_deletedAt_idx" ON "CandidateActivity"("deletedAt");

ALTER TABLE "CompOffEntry" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CompOffEntry" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CompOffEntry" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CompOffEntry" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "CompOffEntry" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CompOffEntry" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "CompOffEntry" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "CompOffEntry" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "CompOffEntry_deletedAt_idx" ON "CompOffEntry"("deletedAt");

ALTER TABLE "ComplaintActivity" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ComplaintActivity" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ComplaintActivity" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ComplaintActivity" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ComplaintActivity" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ComplaintActivity" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ComplaintActivity" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ComplaintActivity" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ComplaintActivity_deletedAt_idx" ON "ComplaintActivity"("deletedAt");

ALTER TABLE "CreditNoteAllocation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CreditNoteAllocation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "CreditNoteAllocation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "CreditNoteAllocation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "CreditNoteAllocation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CreditNoteAllocation" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "CreditNoteAllocation" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "CreditNoteAllocation" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "CreditNoteAllocation_deletedAt_idx" ON "CreditNoteAllocation"("deletedAt");

ALTER TABLE "DeviceEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DeviceEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "DeviceEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "DeviceEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "DeviceEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "DeviceEvent" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "DeviceEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "DeviceEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "DeviceEvent_deletedAt_idx" ON "DeviceEvent"("deletedAt");

ALTER TABLE "HelpdeskComment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "HelpdeskComment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "HelpdeskComment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "HelpdeskComment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "HelpdeskComment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "HelpdeskComment" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "HelpdeskComment" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "HelpdeskComment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "HelpdeskComment_deletedAt_idx" ON "HelpdeskComment"("deletedAt");

ALTER TABLE "InstallationChallanAssignee" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InstallationChallanAssignee" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InstallationChallanAssignee" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InstallationChallanAssignee" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InstallationChallanAssignee" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InstallationChallanAssignee" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "InstallationChallanAssignee" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InstallationChallanAssignee" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InstallationChallanAssignee_deletedAt_idx" ON "InstallationChallanAssignee"("deletedAt");

ALTER TABLE "InterviewInterviewer" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InterviewInterviewer" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InterviewInterviewer" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InterviewInterviewer" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InterviewInterviewer" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InterviewInterviewer" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "InterviewInterviewer" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InterviewInterviewer" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InterviewInterviewer_deletedAt_idx" ON "InterviewInterviewer"("deletedAt");

ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InvoicePayment" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "InvoicePayment" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InvoicePayment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InvoicePayment_deletedAt_idx" ON "InvoicePayment"("deletedAt");

ALTER TABLE "InvoiceRevision" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoiceRevision" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "InvoiceRevision" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "InvoiceRevision" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "InvoiceRevision" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "InvoiceRevision" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "InvoiceRevision" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "InvoiceRevision" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "InvoiceRevision_deletedAt_idx" ON "InvoiceRevision"("deletedAt");

ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "JournalLine" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "JournalLine" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "JournalLine" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "JournalLine_deletedAt_idx" ON "JournalLine"("deletedAt");

ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "LeadActivity" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "LeadActivity" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "LeadActivity" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "LeadActivity_deletedAt_idx" ON "LeadActivity"("deletedAt");

ALTER TABLE "LeadNote" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeadNote" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeadNote" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeadNote" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "LeadNote_deletedAt_idx" ON "LeadNote"("deletedAt");

ALTER TABLE "LifecycleChecklistItem" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LifecycleChecklistItem" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LifecycleChecklistItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LifecycleChecklistItem" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "LifecycleChecklistItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "LifecycleChecklistItem" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "LifecycleChecklistItem" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "LifecycleChecklistItem" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "LifecycleChecklistItem_deletedAt_idx" ON "LifecycleChecklistItem"("deletedAt");

ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "NotificationDelivery" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "NotificationDelivery" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "NotificationDelivery" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "NotificationDelivery_deletedAt_idx" ON "NotificationDelivery"("deletedAt");

ALTER TABLE "PayslipLine" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PayslipLine" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PayslipLine" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PayslipLine" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PayslipLine" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PayslipLine" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PayslipLine" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PayslipLine" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PayslipLine_deletedAt_idx" ON "PayslipLine"("deletedAt");

ALTER TABLE "PolicyAcknowledgement" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PolicyAcknowledgement" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PolicyAcknowledgement" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PolicyAcknowledgement" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PolicyAcknowledgement" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PolicyAcknowledgement" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PolicyAcknowledgement" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PolicyAcknowledgement" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PolicyAcknowledgement_deletedAt_idx" ON "PolicyAcknowledgement"("deletedAt");

ALTER TABLE "PrivilegedAccessEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PrivilegedAccessEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PrivilegedAccessEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PrivilegedAccessEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PrivilegedAccessEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "PrivilegedAccessEvent" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "PrivilegedAccessEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "PrivilegedAccessEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PrivilegedAccessEvent_deletedAt_idx" ON "PrivilegedAccessEvent"("deletedAt");

ALTER TABLE "ProductPurchasePrice" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductPurchasePrice" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProductPurchasePrice" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProductPurchasePrice" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProductPurchasePrice" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProductPurchasePrice" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ProductPurchasePrice" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProductPurchasePrice" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProductPurchasePrice_deletedAt_idx" ON "ProductPurchasePrice"("deletedAt");

ALTER TABLE "ProjectManager" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectManager" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectManager" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectManager" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProjectManager" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProjectManager" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ProjectManager" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProjectManager" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProjectManager_deletedAt_idx" ON "ProjectManager"("deletedAt");

ALTER TABLE "ProjectTaskManager" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectTaskManager" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectTaskManager" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTaskManager" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProjectTaskManager" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProjectTaskManager" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ProjectTaskManager" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProjectTaskManager" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProjectTaskManager_deletedAt_idx" ON "ProjectTaskManager"("deletedAt");

ALTER TABLE "ProjectTaskMember" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectTaskMember" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ProjectTaskMember" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTaskMember" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ProjectTaskMember" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ProjectTaskMember" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ProjectTaskMember" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ProjectTaskMember" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ProjectTaskMember_deletedAt_idx" ON "ProjectTaskMember"("deletedAt");

ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ReceiptAllocation" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ReceiptAllocation" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ReceiptAllocation" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ReceiptAllocation_deletedAt_idx" ON "ReceiptAllocation"("deletedAt");

ALTER TABLE "ReplacementEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReplacementEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ReplacementEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReplacementEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ReplacementEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ReplacementEvent" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "ReplacementEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ReplacementEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ReplacementEvent_deletedAt_idx" ON "ReplacementEvent"("deletedAt");

ALTER TABLE "SkillZoneCandidate" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SkillZoneCandidate" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SkillZoneCandidate" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SkillZoneCandidate" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SkillZoneCandidate" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SkillZoneCandidate" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "SkillZoneCandidate" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SkillZoneCandidate" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SkillZoneCandidate_deletedAt_idx" ON "SkillZoneCandidate"("deletedAt");

ALTER TABLE "StaffChecklistEntry" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffChecklistEntry" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StaffChecklistEntry" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StaffChecklistEntry" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "StaffChecklistEntry_deletedAt_idx" ON "StaffChecklistEntry"("deletedAt");

ALTER TABLE "StaffLoanRepayment" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffLoanRepayment" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StaffLoanRepayment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StaffLoanRepayment" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StaffLoanRepayment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StaffLoanRepayment" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "StaffLoanRepayment" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StaffLoanRepayment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StaffLoanRepayment_deletedAt_idx" ON "StaffLoanRepayment"("deletedAt");

ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StockMovement" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StockMovement_deletedAt_idx" ON "StockMovement"("deletedAt");

ALTER TABLE "StockUnitEvent" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockUnitEvent" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StockUnitEvent" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StockUnitEvent" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StockUnitEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StockUnitEvent" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "StockUnitEvent" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StockUnitEvent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StockUnitEvent_deletedAt_idx" ON "StockUnitEvent"("deletedAt");

ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "SupplierPaymentAllocation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "SupplierPaymentAllocation" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "SupplierPaymentAllocation" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "SupplierPaymentAllocation" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SupplierPaymentAllocation_deletedAt_idx" ON "SupplierPaymentAllocation"("deletedAt");

ALTER TABLE "VisitChange" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "VisitChange" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "VisitChange" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "VisitChange" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "VisitChange" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "VisitChange" SET "updatedAt" = COALESCE("updatedAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "VisitChange" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "VisitChange" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "VisitChange_deletedAt_idx" ON "VisitChange"("deletedAt");

ALTER TABLE "WebPresence" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WebPresence" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "WebPresence" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "WebPresence" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "WebPresence_deletedAt_idx" ON "WebPresence"("deletedAt");
