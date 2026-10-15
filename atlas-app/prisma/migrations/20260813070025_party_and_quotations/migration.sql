/*
  Warnings:

  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_customerTypeId_fkey";

-- DropTable
DROP TABLE "Customer";

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "partyCode" TEXT NOT NULL,
    "isCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "gstin" TEXT,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "designation" TEXT,
    "phone" TEXT NOT NULL,
    "phoneCc" TEXT NOT NULL DEFAULT '+91',
    "altPhone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "customerTypeId" TEXT,
    "source" TEXT,
    "customerSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedManagerId" TEXT,
    "birthday" TIMESTAMP(3),
    "weddingAnniversary" TIMESTAMP(3),
    "addressLine1" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "deliveryAddress" TEXT,
    "deliverySameAsBilling" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "locationNote" TEXT,
    "creditLimitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditLimitDays" INTEGER NOT NULL DEFAULT 0,
    "subscribeSms" BOOLEAN NOT NULL DEFAULT true,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "currentBalancePaise" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "supplierType" TEXT,
    "payablePaise" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastPurchaseAt" TIMESTAMP(3),
    "lastCommunicationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TncTemplate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TncTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "leadId" TEXT,
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
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validityPeriodDays" INTEGER NOT NULL DEFAULT 15,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "salespersonId" TEXT,
    "courierId" TEXT,
    "deliveryMode" TEXT,
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
    "costPricePaise" INTEGER NOT NULL DEFAULT 0,
    "transportPaise" INTEGER NOT NULL DEFAULT 0,
    "incentivePaise" INTEGER NOT NULL DEFAULT 0,
    "tncTemplateId" TEXT,
    "termsBody" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
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

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_storeId_isCustomer_idx" ON "Party"("storeId", "isCustomer");

-- CreateIndex
CREATE INDEX "Party_storeId_isSupplier_idx" ON "Party"("storeId", "isSupplier");

-- CreateIndex
CREATE INDEX "Party_storeId_phone_idx" ON "Party"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Party_storeId_partyCode_key" ON "Party"("storeId", "partyCode");

-- CreateIndex
CREATE UNIQUE INDEX "TncTemplate_storeId_name_key" ON "TncTemplate"("storeId", "name");

-- CreateIndex
CREATE INDEX "Quotation_storeId_status_idx" ON "Quotation"("storeId", "status");

-- CreateIndex
CREATE INDEX "Quotation_storeId_quotationDate_idx" ON "Quotation"("storeId", "quotationDate");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_storeId_quotationNo_key" ON "Quotation"("storeId", "quotationNo");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "CustomerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tncTemplateId_fkey" FOREIGN KEY ("tncTemplateId") REFERENCES "TncTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
