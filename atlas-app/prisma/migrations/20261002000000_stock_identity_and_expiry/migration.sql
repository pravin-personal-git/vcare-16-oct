-- Stock identity and expiry (2 Oct 2026).
--
-- Three additions, all expand-only: every column has a default or is nullable,
-- so the running deployment keeps working between this migration and the code
-- that reads it.
--
-- 1. `StockUnit.identitySource` - where a unit's number came from. Needed
--    because goods receipt now creates one unit per item received (Rule 1 of
--    09-documentation/03-specs/STOCK-IDENTITY-SPEC.md) and issues a house tag
--    where the vendor printed no serial. Without this column a house tag and a
--    manufacturer's serial are indistinguishable, and only one of them means
--    anything to a supplier on a warranty claim.
--
-- 2. `Product.tracksExpiry` / `shelfLifeDays` / `expiryWarnDays` - whether a
--    product goes out of date, how long it keeps, and how much notice to give.
--    Off for everything that exists today, which is correct: `tracksExpiry` is
--    false for all 1,339 products until somebody turns it on per product.
--
-- 3. `Organization.enabledFeatures` - the platform owner's per-client switch
--    for capabilities that are not a whole sidebar module. Empty by default,
--    which is exactly every tenant's behaviour before it existed.

-- ---- 1. identity source ----------------------------------------------------
ALTER TABLE "StockUnit"
  ADD COLUMN IF NOT EXISTS "identitySource" TEXT NOT NULL DEFAULT 'vendor';

-- EVERY EXISTING UNIT IS `migrated`, NOT `vendor`.
--
-- The column default has to be `vendor` so new rows written by code that does
-- not set it are treated as real serials. But the 2,775 units already on file
-- came in with historical data: every one of their events is `migrated`, their
-- provenance is whatever the previous system held, and claiming they are
-- verified manufacturer serials would be a confident false statement about
-- 2,775 physical items. So they are marked for what they are, once, here.
--
-- Matched on the unit having no event other than a migrated one, so a unit
-- genuinely received through Atlas keeps `vendor`.
UPDATE "StockUnit" u
SET "identitySource" = 'migrated'
WHERE u."identitySource" = 'vendor'
  AND NOT EXISTS (
    SELECT 1 FROM "StockUnitEvent" e
    WHERE e."unitId" = u."id" AND e."eventType" <> 'migrated'
  );

CREATE INDEX IF NOT EXISTS "StockUnit_storeId_identitySource_idx"
  ON "StockUnit" ("storeId", "identitySource");

-- ---- 2. expiry -------------------------------------------------------------
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shelfLifeDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "expiryWarnDays" INTEGER;

-- A batch-tracked product that already carries expiry dates on its lots is
-- plainly a product that expires. Nobody filled in those dates by accident.
-- Turning the flag on for them means the expiry report is correct on day one
-- rather than after somebody edits every product by hand.
UPDATE "Product" p
SET "tracksExpiry" = true
WHERE p."tracksExpiry" = false
  AND (
    EXISTS (SELECT 1 FROM "StockLot" l WHERE l."productId" = p."id" AND l."expiryDate" IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM "GoodsReceiptNoteItem" g
      WHERE g."productId" = p."id" AND g."expiryDate" IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS "Product_storeId_tracksExpiry_idx"
  ON "Product" ("storeId", "tracksExpiry");

-- ---- 3. platform feature switches -----------------------------------------
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "enabledFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A tenant already recording expiry dates is already using the capability, so
-- switching it off for them would hide data they can see today. The platform
-- owner can still turn it off deliberately; this only avoids taking it away by
-- deploying.
UPDATE "Organization" o
SET "enabledFeatures" = array_append(o."enabledFeatures", 'expiry')
WHERE NOT ('expiry' = ANY (o."enabledFeatures"))
  AND EXISTS (
    SELECT 1 FROM "Store" s
    JOIN "Product" p ON p."storeId" = s."id"
    WHERE s."organizationId" = o."id" AND p."tracksExpiry" = true
  );

-- ---- 4. Inventory > Stock Checks -------------------------------------------
--
-- Where the two findings above surface: products whose shelf count disagrees
-- with the items Atlas can name, and stock about to go out of date. Both were
-- already being recorded and neither was ever read by a screen.
--
-- Idempotent, inheriting both store and role visibility from its parent, so a
-- branch with Inventory switched off does not suddenly gain a row.
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-inventory-stock-health', parent."id", 'Stock Checks', '/reports/stock-health',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'Inventory' AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/reports/stock-health')
LIMIT 1;

INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-inventory-stock-health', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'Inventory'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-stock-health')
ON CONFLICT ("storeId", "menuId") DO NOTHING;

INSERT INTO "RoleMenuConfig" ("storeId", "roleId", "menuId", "isVisible")
SELECT rmc."storeId", rmc."roleId", 'menu-inventory-stock-health', rmc."isVisible"
FROM "RoleMenuConfig" rmc
JOIN "Menu" parent ON parent."id" = rmc."menuId" AND parent."label" = 'Inventory'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-inventory-stock-health')
ON CONFLICT ("storeId", "roleId", "menuId") DO NOTHING;
