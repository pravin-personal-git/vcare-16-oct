-- Travel / fuel allowance from km (F-03, 6 Oct 2026). Additive: a branch with
-- no row has the allowance switched off, exactly as before.
CREATE TABLE IF NOT EXISTS "TravelSettings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "TravelSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TravelSettings_storeId_key"
    ON "TravelSettings"("storeId");

DO $$ BEGIN
  ALTER TABLE "TravelSettings"
      ADD CONSTRAINT "TravelSettings_storeId_fkey" FOREIGN KEY ("storeId")
      REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Money rules are argued about at payout time: who changed the rate, and when.
DROP TRIGGER IF EXISTS atlas_audit ON "TravelSettings";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "TravelSettings" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
