-- 28 Sep 2026 (Pravin): unused parts come back only when the store receives
-- them, and a replacement's old unit is tracked into a Replacements case.
ALTER TABLE "JobChallanLine" ADD COLUMN "qtyReturnPending" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FaultyPartReturn" ADD COLUMN "challanLineId" TEXT;
ALTER TABLE "FaultyPartReturn" ADD COLUMN "replacementCaseId" TEXT;
ALTER TABLE "FaultyPartReturn" ADD CONSTRAINT "FaultyPartReturn_challanLineId_fkey" FOREIGN KEY ("challanLineId") REFERENCES "JobChallanLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FaultyPartReturn" ADD CONSTRAINT "FaultyPartReturn_replacementCaseId_fkey" FOREIGN KEY ("replacementCaseId") REFERENCES "ReplacementCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
