-- Purchase bills say whether the goods have arrived; a receipt can be billed
-- later; serials can be captured on the bill line (28 Oct 2026, Vcare).
ALTER TABLE "PurchaseBill" ADD COLUMN IF NOT EXISTS "goodsStatus" TEXT NOT NULL DEFAULT 'received';
ALTER TABLE "PurchaseBillItem" ADD COLUMN IF NOT EXISTS "serials" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "billedOnId" TEXT;
CREATE INDEX IF NOT EXISTS "GoodsReceiptNote_billedOnId_idx" ON "GoodsReceiptNote"("billedOnId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsReceiptNote_billedOnId_fkey') THEN
    ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_billedOnId_fkey"
      FOREIGN KEY ("billedOnId") REFERENCES "PurchaseBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
