-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "openingBalancePaise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "debitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditPaise" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "matchedType" TEXT,
    "matchedId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_txnDate_idx" ON "BankTransaction"("bankAccountId", "txnDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_txnDate_description_debitPa_key" ON "BankTransaction"("bankAccountId", "txnDate", "description", "debitPaise", "creditPaise");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
