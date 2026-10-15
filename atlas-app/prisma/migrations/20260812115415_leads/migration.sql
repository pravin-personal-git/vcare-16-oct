-- CreateTable
CREATE TABLE "LeadStage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "isGroupHeader" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeadStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDealStage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeadDealStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "leadCode" TEXT NOT NULL,
    "businessName" TEXT,
    "gstin" TEXT,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "designation" TEXT,
    "mobile" TEXT NOT NULL,
    "mobileCc" TEXT NOT NULL DEFAULT '+91',
    "altMobile" TEXT,
    "email" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "locationNote" TEXT,
    "refCode" TEXT,
    "dealStageId" TEXT,
    "stageId" TEXT,
    "customerTypeId" TEXT,
    "sourceId" TEXT,
    "assignedToUserId" TEXT,
    "sharedWithPartner" TEXT,
    "sinceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requirement" TEXT,
    "notes" TEXT,
    "potentialPaise" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT,
    "lastTalkAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "transferOn" TIMESTAMP(3),
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "convertedCustomerId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTag" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "outcome" TEXT,
    "durationSec" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "note" TEXT,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPolicy" (
    "storeId" TEXT NOT NULL,
    "expiryDays" INTEGER NOT NULL DEFAULT 90,
    "allowDuplicateMobile" BOOLEAN NOT NULL DEFAULT true,
    "officeStartTime" TEXT NOT NULL DEFAULT '09:30',

    CONSTRAINT "LeadPolicy_pkey" PRIMARY KEY ("storeId")
);

-- CreateIndex
CREATE INDEX "LeadStage_storeId_sort_idx" ON "LeadStage"("storeId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_storeId_name_key" ON "LeadSource"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDealStage_storeId_name_key" ON "LeadDealStage"("storeId", "name");

-- CreateIndex
CREATE INDEX "Lead_storeId_isClosed_idx" ON "Lead"("storeId", "isClosed");

-- CreateIndex
CREATE INDEX "Lead_storeId_stageId_idx" ON "Lead"("storeId", "stageId");

-- CreateIndex
CREATE INDEX "Lead_storeId_mobile_idx" ON "Lead"("storeId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_storeId_leadCode_key" ON "Lead"("storeId", "leadCode");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTag_leadId_tag_key" ON "LeadTag"("leadId", "tag");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_occurredAt_idx" ON "LeadActivity"("leadId", "occurredAt");

-- AddForeignKey
ALTER TABLE "LeadStage" ADD CONSTRAINT "LeadStage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LeadStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_dealStageId_fkey" FOREIGN KEY ("dealStageId") REFERENCES "LeadDealStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "LeadStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
