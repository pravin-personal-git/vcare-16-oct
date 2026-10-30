-- Scorecard (31 Oct 2026): reassign reasons, daily phone health, clearings, notes, settings.
CREATE TABLE "JobReassign" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobReassign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobReassign_storeId_createdAt_idx" ON "JobReassign"("storeId", "createdAt");
CREATE INDEX "JobReassign_complaintId_idx" ON "JobReassign"("complaintId");

CREATE TABLE "DeviceHealthDay" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "flags" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceHealthDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceHealthDay_userId_day_key" ON "DeviceHealthDay"("userId", "day");
CREATE INDEX "DeviceHealthDay_storeId_day_idx" ON "DeviceHealthDay"("storeId", "day");

CREATE TABLE "ScoreClearing" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "clearedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreClearing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScoreClearing_subjectUserId_ruleKey_refId_key" ON "ScoreClearing"("subjectUserId", "ruleKey", "refId");
CREATE INDEX "ScoreClearing_storeId_createdAt_idx" ON "ScoreClearing"("storeId", "createdAt");

CREATE TABLE "ScoreNote" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "amountPaise" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreNote_userId_createdAt_idx" ON "ScoreNote"("userId", "createdAt");

CREATE TABLE "ScorecardSettings" (
    "storeId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScorecardSettings_pkey" PRIMARY KEY ("storeId")
);
