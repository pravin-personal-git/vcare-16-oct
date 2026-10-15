-- A2 (11 Oct 2026): a no-login customer link for sales orders (/o/<token>)
-- and installations (/c/<token>), as invoices (/i) and quotations (/q) have.
-- Expand-only: two nullable columns, nothing removed.

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "publicToken" TEXT;
ALTER TABLE "InstallationChallan" ADD COLUMN     "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_publicToken_key" ON "SalesOrder"("publicToken");
CREATE UNIQUE INDEX "InstallationChallan_publicToken_key" ON "InstallationChallan"("publicToken");
