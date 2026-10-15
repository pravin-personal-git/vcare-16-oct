-- The AMC OFFER on a product, and the CHOICE recorded at the point of sale.
--
-- Three different things, kept apart on purpose:
--   Product.warrantyMonths  - free cover that comes with the goods
--   Product.amc*            - a price-list fact: this product CAN have an AMC
--   AmcContract             - a signed agreement with one named customer
--
-- Nobody is covered by anything until a contract exists. Issuing an invoice
-- whose line carries amcOpted creates that contract - see
-- createContractsForInvoice in src/server/amc.ts.
--
-- Structure only, no data. Every column is nullable or carries a default, so
-- existing rows need no backfill: amcAvailable defaults false, which reads as
-- "this product offers no AMC" - the correct answer for all 1,325 migrated
-- products until somebody says otherwise.
--
-- AmcContract.originInvoiceItemId is UNIQUE, and that uniqueness is
-- load-bearing: it is the last line of defence against one invoice line
-- producing two contracts, which would double a customer's cover and double
-- what they are billed.
--
-- Generated with prisma migrate diff rather than migrate dev - the shadow
-- database replay fails on 20260923201500. See VCARE-CLIENT-FINDINGS.md.
-- AlterTable
ALTER TABLE "AmcContract" ADD COLUMN     "coverageNote" TEXT,
ADD COLUMN     "originInvoiceId" TEXT,
ADD COLUMN     "originInvoiceItemId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "amcMonths" INTEGER,
ADD COLUMN     "amcOpted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amcPricePaise" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "amcAnnualPricePaise" INTEGER,
ADD COLUMN     "amcAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amcDurationMonths" INTEGER,
ADD COLUMN     "amcPricingMode" TEXT,
ADD COLUMN     "amcTerms" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AmcContract_originInvoiceItemId_key" ON "AmcContract"("originInvoiceItemId");

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_originInvoiceId_fkey" FOREIGN KEY ("originInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_originInvoiceItemId_fkey" FOREIGN KEY ("originInvoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

