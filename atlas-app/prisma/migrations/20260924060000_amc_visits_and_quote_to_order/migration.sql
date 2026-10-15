-- Two things AMC was missing.
--
-- 1. THE VISIT ALLOWANCE IS NOW REAL.
--
-- AmcContract.visitsIncluded recorded "four services a year" and nothing kept
-- the promise - the number could be typed and displayed and never enforced.
-- ServiceVisit.amcContractId is what makes it count: visits used is a COUNT of
-- visits pointing at the contract, derived rather than tallied, so cancelling
-- a visit gives the allowance back automatically.
--
-- Stamped when a visit is COMPLETED, not when it is scheduled. A visit booked
-- and never made must not consume a customer's allowance.
--
-- 2. AN AMC CAN BE QUOTED, NOT JUST INVOICED.
--
-- The sales path is Lead -> Quotation -> Sales Order -> Invoice, and AMC only
-- existed on the last step - so a customer asking "how much with AMC?" could
-- not be given the figure until the bill. These columns carry the choice from
-- the quotation through the order to the invoice, where it becomes a contract.
--
-- Structure only, no backfill needed: every column is nullable or defaults to
-- false, which reads as "no AMC on this line" - correct for every existing row.
-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "amcMonths" INTEGER,
ADD COLUMN     "amcOpted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amcPricePaise" INTEGER;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "amcMonths" INTEGER,
ADD COLUMN     "amcOpted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amcPricePaise" INTEGER;

-- AlterTable
ALTER TABLE "ServiceVisit" ADD COLUMN     "amcContractId" TEXT;

-- CreateIndex
CREATE INDEX "ServiceVisit_amcContractId_idx" ON "ServiceVisit"("amcContractId");

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_amcContractId_fkey" FOREIGN KEY ("amcContractId") REFERENCES "AmcContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

