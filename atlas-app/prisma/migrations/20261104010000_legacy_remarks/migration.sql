-- Remarks from the old Vcare software, shown on the challan, quotation, order
-- and bill they belong to (29 Oct 2026). New table only.
CREATE TABLE IF NOT EXISTS "LegacyRemark" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "docRef" TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "jobRef" TEXT NOT NULL,
  "challanRef" TEXT,
  "kind" TEXT,
  "body" TEXT NOT NULL,
  "authorName" TEXT,
  "at" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyRemark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LegacyRemark_storeId_docRef_sourceRef_key" ON "LegacyRemark"("storeId", "docRef", "sourceRef");
CREATE INDEX IF NOT EXISTS "LegacyRemark_storeId_docRef_at_idx" ON "LegacyRemark"("storeId", "docRef", "at");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegacyRemark_storeId_fkey') THEN
    ALTER TABLE "LegacyRemark" ADD CONSTRAINT "LegacyRemark_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
