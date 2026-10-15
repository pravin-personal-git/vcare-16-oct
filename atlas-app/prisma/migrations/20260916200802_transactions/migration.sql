-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "txnNo" TEXT NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountPaise" INTEGER NOT NULL,
    "categoryAccountCode" TEXT,
    "method" TEXT,
    "fromAccountCode" TEXT,
    "toAccountCode" TEXT,
    "description" TEXT,
    "attachmentPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_storeId_status_txnDate_idx" ON "Transaction"("storeId", "status", "txnDate");

-- CreateIndex
CREATE INDEX "Transaction_storeId_txnType_idx" ON "Transaction"("storeId", "txnType");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_storeId_txnNo_key" ON "Transaction"("storeId", "txnNo");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
