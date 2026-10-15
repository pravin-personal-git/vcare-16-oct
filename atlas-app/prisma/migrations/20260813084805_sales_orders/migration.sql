-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "quotationId" TEXT,
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
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3),
    "salespersonId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fulfilmentStatus" TEXT NOT NULL DEFAULT 'booked',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "amountPaidPaise" INTEGER NOT NULL DEFAULT 0,
    "courierId" TEXT,
    "deliveryMode" TEXT,
    "awbNo" TEXT,
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
    "termsBody" TEXT,
    "notes" TEXT,
    "isInvoiced" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "srNo" INTEGER NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productCode" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "lineDiscountPaise" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "dispatchedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrder_storeId_fulfilmentStatus_idx" ON "SalesOrder"("storeId", "fulfilmentStatus");

-- CreateIndex
CREATE INDEX "SalesOrder_storeId_paymentStatus_idx" ON "SalesOrder"("storeId", "paymentStatus");

-- CreateIndex
CREATE INDEX "SalesOrder_storeId_orderDate_idx" ON "SalesOrder"("storeId", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_storeId_orderNo_key" ON "SalesOrder"("storeId", "orderNo");

-- CreateIndex
CREATE INDEX "SalesOrderItem_salesOrderId_idx" ON "SalesOrderItem"("salesOrderId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
