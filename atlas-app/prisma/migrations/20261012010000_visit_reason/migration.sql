-- A visit says WHY it is happening, and a new installation can have one.
-- Vcare meeting wave 3, 7 Oct 2026.
--
-- Pravin: "visits need an assignable reason - new installation, or an existing
-- complaint - PURA HI NAYA SYSTEM HONA CHAHIYE."
--
-- WHAT THE DATA SAID. There are 2 service visits on Vcare's database. Two. In
-- the same period there are 906 installation challans, 887 of them with a
-- technician's name on, 240 still pending, and 3,552 complaints. The Visit
-- Scheduler is not lightly used - it is unused, and the reason is structural:
-- a visit could only hang off a COMPLAINT, so the half of Vcare's field work
-- that is a new installation had nowhere to be booked. A challan records that
-- goods were dispatched on a date. It is not an appointment with a customer.
--
-- So three columns:
--
--   reason                 why the technician is going, from a small fixed
--                          list (lib/visit-reasons.ts). Every existing row is
--                          an existing-complaint visit, which is what the
--                          default says, so the backfill is the default.
--
--   installationChallanId  the new installations a visit can now be booked
--                          for. Exactly one of this and complaintId is set,
--                          enforced in the write path and by a CHECK below.
--
--   storeId                a visit used to borrow its store from its
--                          complaint. With complaintId nullable it needs its
--                          own, and every existing row can be given one from
--                          the complaint it already has.
--
-- Expand-only: three columns added, one NOT NULL relaxed, nothing dropped and
-- nothing renamed. Safe to run twice.

-- ===========================================================================
-- 1. THE REASON
-- ===========================================================================
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL DEFAULT 'existing_complaint';

-- ===========================================================================
-- 2. THE NEW INSTALLATION A VISIT CAN BELONG TO
-- ===========================================================================
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "installationChallanId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_installationChallanId_fkey'
  ) THEN
    ALTER TABLE "ServiceVisit"
      ADD CONSTRAINT "ServiceVisit_installationChallanId_fkey"
      FOREIGN KEY ("installationChallanId") REFERENCES "InstallationChallan"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ServiceVisit_installationChallanId_idx"
  ON "ServiceVisit"("installationChallanId");

-- ===========================================================================
-- 3. THE VISIT'S OWN STORE
-- ===========================================================================
--
-- Added nullable, filled from the complaint, then made NOT NULL. Every row
-- that exists today has a complaint, so nothing is left behind; doing it in
-- one statement order rather than two migrations keeps the window where a
-- visit has no store down to this transaction.
ALTER TABLE "ServiceVisit" ADD COLUMN IF NOT EXISTS "storeId" TEXT;

UPDATE "ServiceVisit" v
   SET "storeId" = c."storeId"
  FROM "Complaint" c
 WHERE v."complaintId" = c."id"
   AND v."storeId" IS NULL;

DO $$
BEGIN
  -- Only once every row has one. If some row somehow has no store, leave the
  -- column nullable rather than fail the deploy - a refused migration on a
  -- live database is worse than a column that is not yet strict, and the
  -- write path sets it on every new row either way.
  IF NOT EXISTS (SELECT 1 FROM "ServiceVisit" WHERE "storeId" IS NULL) THEN
    ALTER TABLE "ServiceVisit" ALTER COLUMN "storeId" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_storeId_fkey') THEN
    ALTER TABLE "ServiceVisit"
      ADD CONSTRAINT "ServiceVisit_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ServiceVisit_storeId_scheduledAt_idx"
  ON "ServiceVisit"("storeId", "scheduledAt");

-- ===========================================================================
-- 4. THE COMPLAINT BECOMES OPTIONAL
-- ===========================================================================
ALTER TABLE "ServiceVisit" ALTER COLUMN "complaintId" DROP NOT NULL;

-- A visit is about exactly one thing. Written as a constraint and not only in
-- the server, because a visit attached to neither is a row no screen can draw
-- and a visit attached to both is two answers to "whose job is this".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_one_subject') THEN
    ALTER TABLE "ServiceVisit"
      ADD CONSTRAINT "ServiceVisit_one_subject"
      CHECK (("complaintId" IS NOT NULL) <> ("installationChallanId" IS NOT NULL));
  END IF;
END $$;
