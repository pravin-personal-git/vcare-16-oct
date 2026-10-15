-- Renewal cycles, stored notifications, personal reminders, approval rules, push tokens
-- (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md). Expand-only.
-- NOTE: prisma migrate diff also proposes DROP INDEX "RepairChallan_assigneeIds_idx" - hand-made GIN index, left out on purpose.


-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "amountPaise" INTEGER,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "href" TEXT,
ADD COLUMN     "lastNudgedAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "PolicyRenewal" ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "expectedAmountPaise" INTEGER,
ADD COLUMN     "frequency" TEXT NOT NULL DEFAULT 'yearly',
ADD COLUMN     "ownerKind" TEXT NOT NULL DEFAULT 'company',
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "remindClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderOffsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "responsibleUserId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "PolicyRenewalPayment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRenewalPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalReminder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "repeat" TEXT NOT NULL DEFAULT 'none',
    "entityType" TEXT,
    "entityId" TEXT,
    "href" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "needsApproval" BOOLEAN NOT NULL DEFAULT true,
    "thresholdPaise" INTEGER,
    "skipRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skipUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nudgeHours" INTEGER NOT NULL DEFAULT 24,
    "escalateHours" INTEGER NOT NULL DEFAULT 48,
    "escalateTo" TEXT NOT NULL DEFAULT 'owner',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRuleLevel" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverKind" TEXT NOT NULL,
    "roleId" TEXT,
    "userId" TEXT,
    "minAmountPaise" INTEGER,

    CONSTRAINT "ApprovalRuleLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyRenewalPayment_policyId_dueDate_idx" ON "PolicyRenewalPayment"("policyId", "dueDate");

-- CreateIndex
CREATE INDEX "PolicyRenewalPayment_storeId_paidAt_idx" ON "PolicyRenewalPayment"("storeId", "paidAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_storeId_createdAt_idx" ON "Notification"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_storeId_userId_key" ON "NotificationSetting"("storeId", "userId");

-- CreateIndex
CREATE INDEX "PersonalReminder_userId_doneAt_dueAt_idx" ON "PersonalReminder"("userId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "PersonalReminder_storeId_dueAt_idx" ON "PersonalReminder"("storeId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRule_storeId_requestType_key" ON "ApprovalRule"("storeId", "requestType");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRuleLevel_ruleId_level_key" ON "ApprovalRuleLevel"("ruleId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "PolicyRenewal" ADD CONSTRAINT "PolicyRenewal_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRenewalPayment" ADD CONSTRAINT "PolicyRenewalPayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRenewalPayment" ADD CONSTRAINT "PolicyRenewalPayment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PolicyRenewal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalReminder" ADD CONSTRAINT "PersonalReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRuleLevel" ADD CONSTRAINT "ApprovalRuleLevel_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit trail, like every business table (audit-coverage.test.ts).
DROP TRIGGER IF EXISTS atlas_audit ON "PolicyRenewalPayment";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PolicyRenewalPayment" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Notification";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Notification" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "NotificationDelivery";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "NotificationSetting";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "NotificationSetting" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PersonalReminder";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PersonalReminder" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ApprovalRule";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ApprovalRule" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ApprovalRuleLevel";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ApprovalRuleLevel" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "PushToken";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PushToken" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
