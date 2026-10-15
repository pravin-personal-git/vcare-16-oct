-- The stock chain, passwords, and burnt document numbers (3 Oct 2026).
--
-- Expand-only: every column added is nullable or has a default, and the one new
-- table is additive. The running deployment keeps working between this migration
-- and the code that reads it.

-- ===========================================================================
-- 1. PASSWORDS
-- ===========================================================================
--
-- The request was a screen showing each employee's password. That is not
-- possible - `passwordHash` is a one-way scrypt fingerprint, so there is no
-- password stored to show - and making it possible would mean one database leak
-- handing over every employee's password in plain text, which people reuse on
-- their bank. src/lib/password-policy.ts carries the whole reasoning.
--
-- What the request was really about - "I have to invent and type a password
-- every time" - is solved by generating one, showing it once, and making the
-- person replace it at their next sign-in. These two columns are that.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP(3);

-- Nobody existing is forced to change anything by a deployment. The flag is set
-- only by an administrator resetting a password from this point on; flipping it
-- on for every user would lock an entire client's staff out of the phone app
-- (which refuses a temporary password) on the morning of the deploy.
--
-- `passwordSetAt` is left NULL for existing users rather than back-dated to
-- `createdAt`: when their password was last set is genuinely unknown, and a
-- confident wrong date on a security screen is worse than a blank one.

-- ===========================================================================
-- 2. BURNT DOCUMENT NUMBERS
-- ===========================================================================
--
-- A number is allocated, then the document is written. If that write fails the
-- number is gone - INV-0007 then INV-0009, with nothing recording that 0008 ever
-- existed. GST expects an unbroken invoice series and an auditor who finds a gap
-- asks what was in it.
--
-- One row per number issued, written in the same call that advances the
-- sequence, so a gap can be explained - and an unclaimed number is handed out
-- again before a fresh one is taken, so the ordinary case leaves no gap at all.
CREATE TABLE IF NOT EXISTS "DocumentNumberAllocation" (
  "id"            TEXT NOT NULL,
  "storeId"       TEXT NOT NULL,
  "docType"       TEXT NOT NULL,
  "financialYear" INTEGER NOT NULL,
  "sequence"      INTEGER NOT NULL,
  "number"        TEXT NOT NULL,
  "claimedAt"     TIMESTAMP(3),
  "reissuedAt"    TIMESTAMP(3),
  "allocatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "allocatedBy"   TEXT,
  CONSTRAINT "DocumentNumberAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentNumberAllocation_series_key"
  ON "DocumentNumberAllocation" ("storeId", "docType", "financialYear", "sequence");
CREATE INDEX IF NOT EXISTS "DocumentNumberAllocation_storeId_docType_claimedAt_idx"
  ON "DocumentNumberAllocation" ("storeId", "docType", "claimedAt");
CREATE INDEX IF NOT EXISTS "DocumentNumberAllocation_storeId_number_idx"
  ON "DocumentNumberAllocation" ("storeId", "number");

DO $$
BEGIN
  ALTER TABLE "DocumentNumberAllocation"
    ADD CONSTRAINT "DocumentNumberAllocation_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The ledger starts empty on purpose. Backfilling a row per existing document
-- would claim we know when each number was issued and by whom, and we do not -
-- only that something holds it. The report reads the DOCUMENTS as well as this
-- table precisely so gaps older than the ledger are still found; what it cannot
-- do for those is name who burnt them, and it says so on screen.

-- Every staff transaction burned an 'ST' number: it was allocated and then used
-- only inside a journal-entry description, never stored on a row. Found while
-- building the ledger above, which is the class of problem it exists to surface.
-- Nullable, because the numbers already issued live only inside those
-- descriptions and are not recoverable.
ALTER TABLE "StaffTransaction"
  ADD COLUMN IF NOT EXISTS "txnNo" TEXT;

-- ===========================================================================
-- 3. THE AUDIT TRIGGER ON THE NEW TABLE
-- ===========================================================================
--
-- Required by audit-coverage.test.ts: every business table carries the trigger,
-- or the build fails. The allocation ledger is business data - who issued which
-- number and when - so it is audited like everything else.
DROP TRIGGER IF EXISTS atlas_audit ON "DocumentNumberAllocation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DocumentNumberAllocation"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
