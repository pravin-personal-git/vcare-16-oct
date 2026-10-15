-- F2 sync columns: config tables (26) - F2-SYNC-FOUNDATION-SPEC.md §4.2, §4.5.
--
-- Settings. Hub wins and nodes receive them read-only, but the hub still has to version what it sends down.
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

ALTER TABLE "AccountingPeriod" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AccountingPeriod" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AccountingPeriod" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AccountingPeriod" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AccountingPeriod_deletedAt_idx" ON "AccountingPeriod"("deletedAt");

ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ApprovalRule_deletedAt_idx" ON "ApprovalRule"("deletedAt");

ALTER TABLE "ApprovalRuleLevel" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ApprovalRuleLevel" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ApprovalRuleLevel" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRuleLevel" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ApprovalRuleLevel" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ApprovalRuleLevel" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ApprovalRuleLevel" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ApprovalRuleLevel" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ApprovalRuleLevel_deletedAt_idx" ON "ApprovalRuleLevel"("deletedAt");

ALTER TABLE "AttendanceMarkPolicy" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AttendanceMarkPolicy" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AttendanceMarkPolicy" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceMarkPolicy" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AttendanceMarkPolicy_deletedAt_idx" ON "AttendanceMarkPolicy"("deletedAt");

ALTER TABLE "AttendancePolicy" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AttendancePolicy" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "AttendancePolicy" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "AttendancePolicy" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AttendancePolicy_deletedAt_idx" ON "AttendancePolicy"("deletedAt");

ALTER TABLE "ComplaintFieldConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ComplaintFieldConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "ComplaintFieldConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ComplaintFieldConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "ComplaintFieldConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "ComplaintFieldConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "ComplaintFieldConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ComplaintFieldConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "ComplaintFieldConfig_deletedAt_idx" ON "ComplaintFieldConfig"("deletedAt");

ALTER TABLE "EmployeeAttendanceRule" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EmployeeAttendanceRule" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "EmployeeAttendanceRule" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "EmployeeAttendanceRule" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "EmployeeAttendanceRule_deletedAt_idx" ON "EmployeeAttendanceRule"("deletedAt");

ALTER TABLE "EntityFieldConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EntityFieldConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "EntityFieldConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "EntityFieldConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "EntityFieldConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "EntityFieldConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "EntityFieldConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "EntityFieldConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "EntityFieldConfig_deletedAt_idx" ON "EntityFieldConfig"("deletedAt");

ALTER TABLE "FinancialYear" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FinancialYear" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "FinancialYear" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "FinancialYear" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "FinancialYear" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "FinancialYear" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "FinancialYear" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "FinancialYear" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "FinancialYear_deletedAt_idx" ON "FinancialYear"("deletedAt");

ALTER TABLE "JobSettings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobSettings" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "JobSettings" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "JobSettings" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "JobSettings_deletedAt_idx" ON "JobSettings"("deletedAt");

ALTER TABLE "LeadPolicy" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LeadPolicy" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "LeadPolicy" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeadPolicy" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "LeadPolicy" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "LeadPolicy" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "LeadPolicy" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "LeadPolicy" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "LeadPolicy_deletedAt_idx" ON "LeadPolicy"("deletedAt");

ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Menu" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "Menu" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Menu" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Menu_deletedAt_idx" ON "Menu"("deletedAt");

ALTER TABLE "NotificationSetting" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NotificationSetting" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "NotificationSetting" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "NotificationSetting" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "NotificationSetting_deletedAt_idx" ON "NotificationSetting"("deletedAt");

ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollConfiguration_deletedAt_idx" ON "PayrollConfiguration"("deletedAt");

ALTER TABLE "Permission" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Permission" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Permission" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Permission" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Permission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Permission" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "Permission" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Permission" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Permission_deletedAt_idx" ON "Permission"("deletedAt");

ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Role" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "Role" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Role" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Role_deletedAt_idx" ON "Role"("deletedAt");

ALTER TABLE "RoleAppAccess" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RoleAppAccess" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "RoleAppAccess" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "RoleAppAccess" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "RoleAppAccess_deletedAt_idx" ON "RoleAppAccess"("deletedAt");

ALTER TABLE "RoleConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RoleConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "RoleConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "RoleConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "RoleConfig_deletedAt_idx" ON "RoleConfig"("deletedAt");

ALTER TABLE "RoleMenuConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RoleMenuConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "RoleMenuConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "RoleMenuConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "RoleMenuConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "RoleMenuConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "RoleMenuConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "RoleMenuConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "RoleMenuConfig_deletedAt_idx" ON "RoleMenuConfig"("deletedAt");

ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "RolePermission" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "RolePermission" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "RolePermission" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "RolePermission_deletedAt_idx" ON "RolePermission"("deletedAt");

ALTER TABLE "StockFieldConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockFieldConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StockFieldConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StockFieldConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StockFieldConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StockFieldConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "StockFieldConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StockFieldConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StockFieldConfig_deletedAt_idx" ON "StockFieldConfig"("deletedAt");

ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "StoreConfig_deletedAt_idx" ON "StoreConfig"("deletedAt");

ALTER TABLE "StoreMenuConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StoreMenuConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "StoreMenuConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StoreMenuConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "StoreMenuConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "StoreMenuConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "StoreMenuConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "StoreMenuConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "StoreMenuConfig_deletedAt_idx" ON "StoreMenuConfig"("deletedAt");

ALTER TABLE "UserAppAccess" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserAppAccess" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "UserAppAccess" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "UserAppAccess" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "UserAppAccess_deletedAt_idx" ON "UserAppAccess"("deletedAt");

ALTER TABLE "UserConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "UserConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "UserConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
CREATE INDEX IF NOT EXISTS "UserConfig_deletedAt_idx" ON "UserConfig"("deletedAt");

ALTER TABLE "UserMenuConfig" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserMenuConfig" ADD COLUMN IF NOT EXISTS "originNodeId" TEXT;
ALTER TABLE "UserMenuConfig" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "UserMenuConfig" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "UserMenuConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "UserMenuConfig" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "UserMenuConfig" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "UserMenuConfig" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "UserMenuConfig_deletedAt_idx" ON "UserMenuConfig"("deletedAt");
