-- Returns and credit notes.
--
-- Purely additive: six new tables, no ALTER on an existing one, no DROP.
-- Nothing that already exists changes shape, so this migration cannot lose a
-- row and can be applied to production while the current version is serving.
--
-- Foreign keys onto existing documents are ON DELETE RESTRICT, deliberately.
-- An invoice with a credit note against it must not be deletable — the credit
-- note references it as the original supply, and GST expects that link to hold.

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partyId" TEXT,
    "customerName" TEXT NOT NULL,
    "gstin" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL DEFAULT 'other',
    "warehouseId" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "hsnCode" TEXT,
    "qty" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'restock',
    "unitPricePaise" INTEGER NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "invoiceLineQty" INTEGER NOT NULL,
    "invoiceLineTaxablePaise" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "salesReturnId" TEXT,
    "partyId" TEXT,
    "customerName" TEXT NOT NULL,
    "organizationName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "billingAddress" TEXT,
    "stateId" TEXT,
    "creditNoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL DEFAULT 'goods_returned',
    "reasonNote" TEXT,
    "taxMode" TEXT NOT NULL,
    "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "itemDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableBasePaise" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "grandTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteItem" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
    "invoiceItemId" TEXT,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "hsnCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "lineDiscountPaise" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreditNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteAllocation" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedBy" TEXT,

    CONSTRAINT "CreditNoteAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "refundNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'bank',
    "reference" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_storeId_returnNo_key" ON "SalesReturn"("storeId", "returnNo");
CREATE INDEX "SalesReturn_storeId_lifecycle_idx" ON "SalesReturn"("storeId", "lifecycle");
CREATE INDEX "SalesReturn_storeId_returnedAt_idx" ON "SalesReturn"("storeId", "returnedAt");
CREATE INDEX "SalesReturn_invoiceId_idx" ON "SalesReturn"("invoiceId");

CREATE INDEX "SalesReturnItem_returnId_idx" ON "SalesReturnItem"("returnId");
CREATE INDEX "SalesReturnItem_invoiceItemId_idx" ON "SalesReturnItem"("invoiceItemId");

CREATE UNIQUE INDEX "CreditNote_storeId_creditNoteNo_key" ON "CreditNote"("storeId", "creditNoteNo");
CREATE INDEX "CreditNote_storeId_lifecycle_idx" ON "CreditNote"("storeId", "lifecycle");
CREATE INDEX "CreditNote_storeId_creditNoteDate_idx" ON "CreditNote"("storeId", "creditNoteDate");
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
CREATE INDEX "CreditNote_salesReturnId_idx" ON "CreditNote"("salesReturnId");

CREATE INDEX "CreditNoteItem_creditNoteId_idx" ON "CreditNoteItem"("creditNoteId");
CREATE INDEX "CreditNoteItem_invoiceItemId_idx" ON "CreditNoteItem"("invoiceItemId");

CREATE INDEX "CreditNoteAllocation_invoiceId_idx" ON "CreditNoteAllocation"("invoiceId");
CREATE INDEX "CreditNoteAllocation_creditNoteId_idx" ON "CreditNoteAllocation"("creditNoteId");
CREATE INDEX "CreditNoteAllocation_storeId_allocatedAt_idx" ON "CreditNoteAllocation"("storeId", "allocatedAt");

CREATE UNIQUE INDEX "Refund_storeId_refundNo_key" ON "Refund"("storeId", "refundNo");
CREATE INDEX "Refund_storeId_refundedAt_idx" ON "Refund"("storeId", "refundedAt");
CREATE INDEX "Refund_creditNoteId_idx" ON "Refund"("creditNoteId");
CREATE INDEX "Refund_partyId_idx" ON "Refund"("partyId");

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SalesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "SalesReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
