-- One invoice over several challans and several orders (2 Oct 2026).
--
-- Expand-only. Two new tables and two new columns with defaults; nothing is
-- dropped, nothing is rewritten, and `Invoice."salesOrderId"` keeps working
-- exactly as it did. The running deployment is correct both before and after.

-- ===========================================================================
-- 1. WHAT AN INVOICE BILLS
-- ===========================================================================
--
-- `Invoice."salesOrderId"` is a single nullable foreign key, so an invoice
-- could point at one order and no more. Vcare sell sites, not orders: three
-- installation challans over four weeks, a second order raised mid-job when
-- the customer adds two cameras, and one bill expected at the end. Four
-- documents against one site is the thing the customer complained about.
--
-- The old column stays and still carries the FIRST order - thirty-odd call
-- sites read it, and a tax document's history is not something to rewrite for
-- tidiness. This table carries all of them.
CREATE TABLE IF NOT EXISTS "InvoiceSource" (
  "id"           TEXT         NOT NULL,
  "storeId"      TEXT         NOT NULL,
  "invoiceId"    TEXT         NOT NULL,
  "kind"         TEXT         NOT NULL,
  "salesOrderId" TEXT,
  "challanId"    TEXT,
  "complaintId"  TEXT,
  "docNo"        TEXT         NOT NULL,
  "docDate"      TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceSource_pkey" PRIMARY KEY ("id")
);

-- One document appears once on one invoice. This catches a double-add in the
-- picker without the picker having to be careful.
--
-- Deliberately NOT a unique on "challanId" alone, although a challan must not
-- be billed twice. A cancelled invoice has to release its challans, and a
-- database unique cannot tell a cancelled invoice from a live one while both
-- rows still exist - nothing here is ever deleted. That refusal belongs in
-- code, where it can ask for a LIVE invoice, exactly as the reversible
-- `SalesOrder."isInvoiced"` flag has always worked.
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceSource_invoiceId_docNo_key"
  ON "InvoiceSource" ("invoiceId", "docNo");
CREATE INDEX IF NOT EXISTS "InvoiceSource_storeId_challanId_idx"
  ON "InvoiceSource" ("storeId", "challanId");
CREATE INDEX IF NOT EXISTS "InvoiceSource_storeId_salesOrderId_idx"
  ON "InvoiceSource" ("storeId", "salesOrderId");
CREATE INDEX IF NOT EXISTS "InvoiceSource_storeId_complaintId_idx"
  ON "InvoiceSource" ("storeId", "complaintId");

-- ===========================================================================
-- 2. WHERE ONE CHARGE CAME FROM
-- ===========================================================================
--
-- The customer's PDF shows the cost and the thing it is being charged for. An
-- employee holding `invoice.costTrail` can open any line and see which
-- documents it came from and how much each contributed.
--
-- Twelve cameras delivered across three challans are ONE line on the bill,
-- because one line is what the customer bought - so this is a list per line,
-- not a column.
--
-- "qty" IS STORED rather than read off the source line. The source line says
-- what was DISPATCHED; this says what was BILLED from it. They are usually
-- equal and must never be assumed to be: a part-billed challan, a short
-- delivery invoiced in full by agreement, or a line split across two invoices
-- all make them differ - and in every one of those cases the invoice's own
-- number is the one that has to add up.
CREATE TABLE IF NOT EXISTS "InvoiceItemSource" (
  "id"               TEXT         NOT NULL,
  "storeId"          TEXT         NOT NULL,
  "invoiceItemId"    TEXT         NOT NULL,
  "kind"             TEXT         NOT NULL,
  "challanId"        TEXT,
  "challanItemId"    TEXT,
  "salesOrderId"     TEXT,
  "salesOrderItemId" TEXT,
  "qty"              INTEGER      NOT NULL,
  "docNo"            TEXT         NOT NULL,
  "docDate"          TIMESTAMP(3) NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"          INTEGER      NOT NULL DEFAULT 1,
  "originNodeId"     TEXT,
  "deletedAt"        TIMESTAMP(3),
  "deletedBy"        TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceItemSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InvoiceItemSource_invoiceItemId_idx"
  ON "InvoiceItemSource" ("invoiceItemId");
CREATE INDEX IF NOT EXISTS "InvoiceItemSource_storeId_challanId_idx"
  ON "InvoiceItemSource" ("storeId", "challanId");
CREATE INDEX IF NOT EXISTS "InvoiceItemSource_storeId_salesOrderId_idx"
  ON "InvoiceItemSource" ("storeId", "salesOrderId");

-- ===========================================================================
-- 3. HAS THIS CHALLAN BEEN BILLED?
-- ===========================================================================
--
-- With one invoice covering several challans, that question stops being
-- answerable from the order: two of its three challans may be on an invoice
-- while the third is still open work. Mirrors `SalesOrder."isInvoiced"`,
-- including being reversible - cancelling the invoice clears it and the
-- challan becomes billable again.
--
-- Every existing challan starts FALSE, which is the honest answer. Vcare's
-- migrated history has invoices and challans that were never linked to each
-- other, so back-filling TRUE would be a guess, and back-filling from the
-- order would mark challans billed that are not on any invoice at all. They
-- surface as billable work, where a person can look at them.
ALTER TABLE "InstallationChallan"
  ADD COLUMN IF NOT EXISTS "isInvoiced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "invoicedAt" TIMESTAMP(3);

-- ===========================================================================
-- 4. FOREIGN KEYS
-- ===========================================================================
--
-- The invoice owns its sources: cancelling an invoice keeps them (cancellation
-- is reversible and the record of what it covered is the point), but deleting
-- the invoice row itself must not leave orphans. Everything a source POINTS AT
-- is left alone - a challan is not deleted because an invoice referenced it.
DO $$ BEGIN
  ALTER TABLE "InvoiceSource" ADD CONSTRAINT "InvoiceSource_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceSource" ADD CONSTRAINT "InvoiceSource_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceSource" ADD CONSTRAINT "InvoiceSource_challanId_fkey"
    FOREIGN KEY ("challanId") REFERENCES "InstallationChallan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceSource" ADD CONSTRAINT "InvoiceSource_complaintId_fkey"
    FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceItemSource" ADD CONSTRAINT "InvoiceItemSource_invoiceItemId_fkey"
    FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceItemSource" ADD CONSTRAINT "InvoiceItemSource_challanId_fkey"
    FOREIGN KEY ("challanId") REFERENCES "InstallationChallan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceItemSource" ADD CONSTRAINT "InvoiceItemSource_challanItemId_fkey"
    FOREIGN KEY ("challanItemId") REFERENCES "InstallationChallanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceItemSource" ADD CONSTRAINT "InvoiceItemSource_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvoiceItemSource" ADD CONSTRAINT "InvoiceItemSource_salesOrderItemId_fkey"
    FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 5. THE AUDIT TRIGGER ON BOTH NEW TABLES
-- ===========================================================================
--
-- Required by audit-coverage.test.ts: every business table carries the trigger
-- or the build fails. What an invoice was billed from is exactly the kind of
-- thing somebody will later claim was always that way.
DROP TRIGGER IF EXISTS atlas_audit ON "InvoiceSource";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InvoiceSource"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();

DROP TRIGGER IF EXISTS atlas_audit ON "InvoiceItemSource";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItemSource"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
