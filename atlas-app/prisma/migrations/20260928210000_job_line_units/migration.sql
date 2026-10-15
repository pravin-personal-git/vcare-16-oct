-- 28 Sep 2026: the serial units a job GDN line issued (returns/cancel bring back exactly those).
ALTER TABLE "JobChallanLine" ADD COLUMN "stockUnitIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "JobChallanLine" ADD COLUMN "unitCostPaise" INTEGER;
ALTER TABLE "JobChallanLine" ADD COLUMN "costAccount" TEXT;
-- Bill this job: the job links to its one invoice.
ALTER TABLE "Complaint" ADD COLUMN "invoiceId" TEXT;
CREATE UNIQUE INDEX "Complaint_invoiceId_key" ON "Complaint"("invoiceId");
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
