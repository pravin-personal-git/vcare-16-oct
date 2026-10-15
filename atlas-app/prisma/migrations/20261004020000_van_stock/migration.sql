-- A technician's van is a warehouse (2 Oct 2026).
--
-- Expand-only. Three nullable columns and one with a default; every existing
-- warehouse becomes `kind = 'store'`, which is what they all are.

-- ===========================================================================
-- 1. WHAT KIND OF WAREHOUSE, AND WHOSE
-- ===========================================================================
--
-- Pravin's decisions 6 and 7: stock handed to a technician sits in the VAN
-- LOCATION, has not left the business, and must come back at the end of the
-- shift or be accounted for.
--
-- A van IS a warehouse. Everything that makes a warehouse useful - a balance
-- per product, movements in and out, somewhere a serial unit can sit - is
-- exactly what answers "what is Tikam carrying?", and "ProductBalance" is
-- already keyed on (productId, warehouseId), so a van gets per-product
-- balances with no new machinery at all.
--
-- The alternative, a separate VanStock table, would be a SECOND stock ledger
-- with its own balances, its own drift, and its own reconciliation against the
-- first. Atlas already has one two-ledger problem - quantity versus identity,
-- see 03-specs/STOCK-IDENTITY-SPEC.md - and it does not need a third invented
-- deliberately.
--
-- So what the kind changes is REPORTING, not mechanics: stock in a van still
-- counts in stock on hand, and "where is it" and "whose is it" are questions
-- only a van asks.
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS "kind"     TEXT NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS "holderId" TEXT;

CREATE INDEX IF NOT EXISTS "Warehouse_storeId_kind_idx" ON "Warehouse" ("storeId", "kind");
CREATE INDEX IF NOT EXISTS "Warehouse_holderId_idx"     ON "Warehouse" ("holderId");

DO $$ BEGIN
  ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_holderId_fkey"
    FOREIGN KEY ("holderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. WHERE ONE PHYSICAL ITEM IS
-- ===========================================================================
--
-- `StockUnit."status"` says what has BECOME of a unit - on the shelf, with a
-- customer, scrapped. It cannot say which shelf, and once a van is a warehouse
-- that distinction starts to matter: a camera in a technician's van is
-- `in_stock`, because it is neither sold nor gone, and a picker offering it at
-- the counter would be offering something nobody at the counter can reach.
--
-- Null means the main warehouse - the same convention "ProductBalance" and
-- "StockMovement" already use for a store with no warehouses configured. Every
-- existing unit therefore keeps exactly the meaning it had.
ALTER TABLE "StockUnit"
  ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

CREATE INDEX IF NOT EXISTS "StockUnit_warehouseId_idx" ON "StockUnit" ("warehouseId");

DO $$ BEGIN
  ALTER TABLE "StockUnit" ADD CONSTRAINT "StockUnit_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
