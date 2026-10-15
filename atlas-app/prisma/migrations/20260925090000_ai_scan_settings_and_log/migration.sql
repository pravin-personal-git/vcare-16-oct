-- Camera scanner: the per-business AI switch (off by default) and monthly
-- cap on the organisation, and a log of AI reads that the cap counts.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiScanEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiScanMonthlyLimit" INTEGER NOT NULL DEFAULT 500;

-- CreateTable
CREATE TABLE "AiScanLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiScanLog_organizationId_createdAt_idx" ON "AiScanLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiScanLog" ADD CONSTRAINT "AiScanLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

