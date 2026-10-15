-- An advance sits with the work it was collected against (2 Oct 2026).
--
-- Expand-only: two nullable columns and their indexes. Every existing receipt
-- keeps working and names neither, which is the honest answer for money that
-- was simply paid on account.

-- ===========================================================================
-- WHAT THIS MONEY WAS COLLECTED AGAINST
-- ===========================================================================
--
-- Pravin's rule: an advance sits with the relevant challan, or with the order
-- if it arrived before any work started. Until now a receipt knew only the
-- customer, so fifty thousand rupees handed to a technician on site on the 8th
-- was indistinguishable a month later from money posted at the office, and
-- nobody could answer "what has this site already paid?".
--
-- Neither column is a link TO an invoice. "ReceiptAllocation" remains the only
-- thing that decides what a receipt settles; these two record where the money
-- came from, which is a different question and one nothing could answer.
ALTER TABLE "Receipt"
  ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "challanId"    TEXT;

CREATE INDEX IF NOT EXISTS "Receipt_storeId_salesOrderId_idx"
  ON "Receipt" ("storeId", "salesOrderId");
CREATE INDEX IF NOT EXISTS "Receipt_storeId_challanId_idx"
  ON "Receipt" ("storeId", "challanId");

DO $$ BEGIN
  ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_challanId_fkey"
    FOREIGN KEY ("challanId") REFERENCES "InstallationChallan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nothing is back-filled. `SalesOrder."amountPaidPaise"` has been incremented
-- directly by `recordPayment` since it was written, with NO receipt and NO
-- journal entry behind it, so there are no receipt rows to attach to those
-- orders - the money was a number on a row and nowhere else. From this
-- migration forward that path writes a real receipt; the historic figures stay
-- as they are and are reported, not invented. See the note in
-- `server/sales-orders.ts` on `recordPayment`.
