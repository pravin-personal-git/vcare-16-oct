-- CreateTable
CREATE TABLE "UserTarget" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "targetPaise" INTEGER NOT NULL DEFAULT 0,
    "incentivePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTarget_storeId_periodStart_idx" ON "UserTarget"("storeId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UserTarget_storeId_userId_periodType_periodStart_key" ON "UserTarget"("storeId", "userId", "periodType", "periodStart");

-- AddForeignKey
ALTER TABLE "UserTarget" ADD CONSTRAINT "UserTarget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTarget" ADD CONSTRAINT "UserTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
