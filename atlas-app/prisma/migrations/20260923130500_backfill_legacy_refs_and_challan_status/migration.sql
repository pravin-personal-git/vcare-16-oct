-- Data migration, no schema change.
--
-- WHY THIS IS A MIGRATION AND NOT A SCRIPT
--
-- The two migrations before this one add `legacyRef` and `RepairChallan.status`.
-- Both were populated on development by a one-off script that also reads the
-- client's MongoDB. Production cannot run that script - nobody has its database
-- credentials on a developer machine, and it should not need them.
--
-- Left alone, deploying those two migrations to production would leave it in a
-- state that is worse than before:
--
--   * `legacyRef` null on every row, so the "was <old number>" reference the
--     client recognises would exist as a column and be empty.
--   * `RepairChallan.status` defaulted to 'pending' on EVERY migrated row -
--     years of completed work rendered as a sign-off backlog. That is not a
--     cosmetic problem; it is the first thing a client would look at and it
--     would be wrong.
--
-- Everything below is expressible in plain SQL against the tenant's own data,
-- so it belongs in the deploy path where `prisma migrate deploy` runs it
-- automatically during the Vercel build. On development it is a no-op, because
-- the script already did exactly this.
--
-- What still cannot be done here, and still needs a human with production
-- credentials: creating the staff logins, resolving complaint owners and
-- technicians (both need the Mongo user roster), and loading the installation
-- challans (needs the Mongo challan collection).

-- ---------------------------------------------------------------- legacyRef
--
-- A migrated document kept its original number AS its document number. Copy
-- that into `legacyRef` so the original reference survives any future
-- renumbering, and so a screen can tell a migrated document from one Atlas
-- issued itself.
--
-- The `NOT LIKE '%-%'` test is what distinguishes the two: Atlas issues
-- {TYPE}-{BRANCH}-{FY}-{SEQ}, which always contains a hyphen, while the
-- migrated numbers are flat (INV202602485). So this only ever touches rows
-- that came from somewhere else, on any database, with no tenant-specific
-- condition needed.

UPDATE "Invoice"    SET "legacyRef" = "invoiceNo"
  WHERE "legacyRef" IS NULL AND "invoiceNo"   NOT LIKE '%-%';

UPDATE "Quotation"  SET "legacyRef" = "quotationNo"
  WHERE "legacyRef" IS NULL AND "quotationNo" NOT LIKE '%-%';

UPDATE "SalesOrder" SET "legacyRef" = "orderNo"
  WHERE "legacyRef" IS NULL AND "orderNo"     NOT LIKE '%-%';

UPDATE "Complaint"  SET "legacyRef" = "complaintNo"
  WHERE "legacyRef" IS NULL AND "complaintNo" NOT LIKE '%-%';

UPDATE "Receipt"    SET "legacyRef" = "receiptNo"
  WHERE "legacyRef" IS NULL AND "receiptNo"   NOT LIKE '%-%';

-- RepairChallan is the exception. One source challan covering several products
-- became one row per product, with a `-n` suffix appended to keep challanNo
-- unique - so the suffix has to come off to recover the original reference,
-- and several rows legitimately share one legacyRef.
UPDATE "RepairChallan" SET "legacyRef" = regexp_replace("challanNo", '-[0-9]+$', '')
  WHERE "legacyRef" IS NULL AND "challanNo" ~ '^[A-Z]+[0-9]+-[0-9]+$';

-- ------------------------------------------------------- challan status
--
-- `status` was added with DEFAULT 'pending', which is correct for a challan
-- raised from now on and wrong for every row that predates the column. The
-- source system's own spread was 78% approved, so defaulting these to
-- 'approved' would be closer to the truth and still an invention. They get
-- 'legacy_unknown' instead, and the UI reads that as "not recorded".
--
-- Where the real status IS recoverable it is written afterwards, by
-- `scratch/vcare-load-challans.mjs`, which needs the source database. That
-- script sweeps to 'legacy_unknown' first and then applies recovered values
-- over the top, so running it after this migration is safe and produces the
-- same result either way.

UPDATE "RepairChallan" SET "status" = 'legacy_unknown'
  WHERE "legacyRef" IS NOT NULL AND "status" = 'pending';
