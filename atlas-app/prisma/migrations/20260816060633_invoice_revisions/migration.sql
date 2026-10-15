-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "InvoiceRevision" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" TEXT[],
    "beforeGrandTotalPaise" INTEGER NOT NULL,
    "afterGrandTotalPaise" INTEGER NOT NULL,
    "beforeLineCount" INTEGER NOT NULL,
    "afterLineCount" INTEGER NOT NULL,
    "beforeLines" JSONB NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceRevision_invoiceId_version_idx" ON "InvoiceRevision"("invoiceId", "version");

-- CreateIndex
CREATE INDEX "InvoiceRevision_storeId_changedAt_idx" ON "InvoiceRevision"("storeId", "changedAt");

-- AddForeignKey
ALTER TABLE "InvoiceRevision" ADD CONSTRAINT "InvoiceRevision_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRevision" ADD CONSTRAINT "InvoiceRevision_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
