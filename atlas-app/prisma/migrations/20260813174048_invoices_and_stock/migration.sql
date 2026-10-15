-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "partyId" TEXT,
    "customerName" TEXT NOT NULL,
    "organizationName" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "gstin" TEXT,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "stateId" TEXT,
    "cityId" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "salespersonId" TEXT,
    "deliveryCharge" INTEGER NOT NULL DEFAULT 0,
    "deliveryExempt" BOOLEAN NOT NULL DEFAULT false,
    "discountType" TEXT NOT NULL DEFAULT 'amount',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "itemDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "orderDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableBasePaise" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "grandTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "taxMode" TEXT NOT NULL DEFAULT 'IGST',
    "amountPaidPaise" INTEGER NOT NULL DEFAULT 0,
    "termsBody" TEXT,
    "notes" TEXT,
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDate" TIMESTAMP(3),
    "qrPayload" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
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

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "recordedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_storeId_lifecycle_idx" ON "Invoice"("storeId", "lifecycle");

-- CreateIndex
CREATE INDEX "Invoice_storeId_invoiceDate_idx" ON "Invoice"("storeId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_storeId_dueDate_idx" ON "Invoice"("storeId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_storeId_invoiceNo_key" ON "Invoice"("storeId", "invoiceNo");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_storeId_paidAt_idx" ON "InvoicePayment"("storeId", "paidAt");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_productId_createdAt_idx" ON "StockMovement"("storeId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
