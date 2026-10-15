-- Workflow slice 9: installation jobs from sales orders.

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "salesOrderId" TEXT;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

