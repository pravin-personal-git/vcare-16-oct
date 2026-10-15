-- RMA receipts and the supplier's answer (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC
-- stage 5): what came back from a supplier, line by line, on its own document
-- (GRR); the supplier's answer and quote on each case; the new serial they
-- sent; and what closed a case when nothing came back.
--
-- Expand-only: one new table, nullable columns on ReplacementCase.
CREATE TABLE IF NOT EXISTS "RmaReceipt" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "dispatchId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courier" TEXT,
    "docketNo" TEXT,
    "courierChargePaise" INTEGER NOT NULL DEFAULT 0,
    "courierPaidBy" TEXT NOT NULL DEFAULT 'none',
    "journalEntryId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "RmaReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RmaReceipt_storeId_receiptNo_key" ON "RmaReceipt"("storeId", "receiptNo");
CREATE INDEX IF NOT EXISTS "RmaReceipt_dispatchId_idx" ON "RmaReceipt"("dispatchId");
DO $$ BEGIN
  ALTER TABLE "RmaReceipt" ADD CONSTRAINT "RmaReceipt_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RmaReceipt" ADD CONSTRAINT "RmaReceipt_dispatchId_fkey"
    FOREIGN KEY ("dispatchId") REFERENCES "SupplierDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RmaReceipt" ADD CONSTRAINT "RmaReceipt_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "supplierAnswer" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "supplierQuotePaise" INTEGER;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "supplierAnswerNote" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "supplierAnswerAt" TIMESTAMP(3);
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "receiptId" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "replacementUnitId" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "closedOn" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN IF NOT EXISTS "supplierReplyRef" TEXT;
DO $$ BEGIN
  ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "RmaReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replacementUnitId_fkey"
    FOREIGN KEY ("replacementUnitId") REFERENCES "StockUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ReplacementCase_receiptId_idx" ON "ReplacementCase"("receiptId");

-- What came back, and what the return courier cost, is audited.
DROP TRIGGER IF EXISTS atlas_audit ON "RmaReceipt";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RmaReceipt" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
