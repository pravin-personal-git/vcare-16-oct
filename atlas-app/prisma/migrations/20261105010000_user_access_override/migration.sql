-- One person's own access to one module in one branch (30 Oct 2026, Vcare).
CREATE TABLE IF NOT EXISTS "UserAccessOverride" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "setBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAccessOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserAccessOverride_storeId_userId_moduleKey_key" ON "UserAccessOverride"("storeId", "userId", "moduleKey");
CREATE INDEX IF NOT EXISTS "UserAccessOverride_userId_idx" ON "UserAccessOverride"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAccessOverride_storeId_fkey') THEN
    ALTER TABLE "UserAccessOverride" ADD CONSTRAINT "UserAccessOverride_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAccessOverride_userId_fkey') THEN
    ALTER TABLE "UserAccessOverride" ADD CONSTRAINT "UserAccessOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
-- Audited like every other table (AGENTS.md section 4): who gave whom what, and when.
DROP TRIGGER IF EXISTS atlas_audit ON "UserAccessOverride";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserAccessOverride" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
