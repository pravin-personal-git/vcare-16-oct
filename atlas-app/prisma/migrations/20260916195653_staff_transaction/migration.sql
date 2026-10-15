-- CreateTable
CREATE TABLE "StaffTransaction" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffTransaction_storeId_userId_txnDate_idx" ON "StaffTransaction"("storeId", "userId", "txnDate");

-- CreateIndex
CREATE INDEX "StaffTransaction_storeId_status_idx" ON "StaffTransaction"("storeId", "status");

-- AddForeignKey
ALTER TABLE "StaffTransaction" ADD CONSTRAINT "StaffTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTransaction" ADD CONSTRAINT "StaffTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
