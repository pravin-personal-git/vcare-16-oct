-- The public catalogue, baskets, and what people did in the shop (3 Oct 2026).
--
-- Expand-only: six new tables and one nullable column. Nothing existing is
-- touched, so the running deployment is correct before and after.

-- ===========================================================================
-- 1. WHAT A PRODUCT LOOKS LIKE IN THE SHOP
-- ===========================================================================
--
-- A separate table rather than columns on "Product": Vcare carry 1,339
-- products and would list perhaps eighty, so eight marketing columns on every
-- product row is a cost paid by every stock query to serve 6% of them. And
-- what a shop says is not what a warehouse knows - "CP PLUS CAMERA DOME IP 2MP
-- DUAL LIGHT VA" is the right name on a GRN and the wrong one on a shop page.
--
-- NO PRICE COLUMN, deliberately. Decision 11: the catalogue shows the PRODUCT
-- price and says installation may cost extra. That price is "ProductPrice" -
-- the same number the quotation and the invoice use - so a change in one place
-- is a change everywhere.
CREATE TABLE IF NOT EXISTS "CatalogueListing" (
  "id"           TEXT         NOT NULL,
  "storeId"      TEXT         NOT NULL,
  "productId"    TEXT         NOT NULL,
  "isListed"     BOOLEAN      NOT NULL DEFAULT false,
  "headline"     TEXT,
  "blurb"        TEXT,
  "deliveryNote" TEXT,
  "offerLabel"   TEXT,
  "sort"         INTEGER      NOT NULL DEFAULT 0,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogueListing_pkey" PRIMARY KEY ("id")
);

-- Unique on its own rather than per store: a product belongs to exactly one
-- store, so a composite would be the same constraint written twice.
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueListing_productId_key"
  ON "CatalogueListing" ("productId");
CREATE INDEX IF NOT EXISTS "CatalogueListing_storeId_isListed_sort_idx"
  ON "CatalogueListing" ("storeId", "isListed", "sort");

CREATE TABLE IF NOT EXISTS "CatalogueImage" (
  "id"           TEXT         NOT NULL,
  "listingId"    TEXT         NOT NULL,
  "path"         TEXT         NOT NULL,
  "alt"          TEXT,
  "sort"         INTEGER      NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogueImage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogueImage_listingId_sort_idx"
  ON "CatalogueImage" ("listingId", "sort");

-- ===========================================================================
-- 2. SEVERAL PRODUCTS SOLD AS ONE THING
-- ===========================================================================
--
-- Decision 14, and the reason this is a grouping and NOT a product: when a
-- combo sells, stock comes off each real product in its own category - 4 from
-- cameras, or 1 from cameras and 2 from storage. The moment stock comes off a
-- "combo" SKU instead, the camera count is wrong and every reorder decision
-- after it is wrong too.
--
-- Deliberately not "BillOfMaterials". A BOM is how something is MADE; a combo
-- is how things are SOLD, and nothing is manufactured. Sharing the table would
-- mean every manufacturing screen had to learn to ignore rows that are not
-- really assemblies.
CREATE TABLE IF NOT EXISTS "CatalogueCombo" (
  "id"           TEXT         NOT NULL,
  "storeId"      TEXT         NOT NULL,
  "name"         TEXT         NOT NULL,
  "blurb"        TEXT,
  "deliveryNote" TEXT,
  "offerLabel"   TEXT,
  "isListed"     BOOLEAN      NOT NULL DEFAULT false,
  "sort"         INTEGER      NOT NULL DEFAULT 0,
  "pricePaise"   INTEGER,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogueCombo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogueCombo_storeId_isListed_sort_idx"
  ON "CatalogueCombo" ("storeId", "isListed", "sort");

CREATE TABLE IF NOT EXISTS "CatalogueComboItem" (
  "id"           TEXT         NOT NULL,
  "comboId"      TEXT         NOT NULL,
  "productId"    TEXT         NOT NULL,
  "qty"          INTEGER      NOT NULL DEFAULT 1,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogueComboItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueComboItem_comboId_productId_key"
  ON "CatalogueComboItem" ("comboId", "productId");
CREATE INDEX IF NOT EXISTS "CatalogueComboItem_productId_idx"
  ON "CatalogueComboItem" ("productId");

-- ===========================================================================
-- 3. BASKETS, INCLUDING THE ONES NOBODY FINISHED
-- ===========================================================================
--
-- The only reason a basket is a row and not a cookie: Pravin asked to see
-- abandoned carts. A cart that lives in the browser is a cart nobody can report
-- on, and "what did people nearly buy" is the question being asked.
--
-- "sessionKey" is how an anonymous visitor keeps a basket before they have an
-- account. When they register, "partyId" is filled in and the basket they built
-- while browsing survives - the difference between a shop and a form.
--
-- NO PAYMENT, ever (decision 10). A cart becomes a REQUEST: a Lead when they
-- want to buy, a complaint when they want somebody to come out.
CREATE TABLE IF NOT EXISTS "Cart" (
  "id"           TEXT         NOT NULL,
  "storeId"      TEXT         NOT NULL,
  "partyId"      TEXT,
  "sessionKey"   TEXT         NOT NULL,
  "status"       TEXT         NOT NULL DEFAULT 'open',
  "leadId"       TEXT,
  "complaintId"  TEXT,
  "message"      TEXT,
  "requestedAt"  TIMESTAMP(3),
  "abandonedAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Cart_storeId_sessionKey_key"
  ON "Cart" ("storeId", "sessionKey");
CREATE INDEX IF NOT EXISTS "Cart_storeId_status_updatedAt_idx"
  ON "Cart" ("storeId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Cart_storeId_partyId_idx"
  ON "Cart" ("storeId", "partyId");

CREATE TABLE IF NOT EXISTS "CartItem" (
  "id"           TEXT         NOT NULL,
  "cartId"       TEXT         NOT NULL,
  "listingId"    TEXT,
  "comboId"      TEXT,
  "qty"          INTEGER      NOT NULL DEFAULT 1,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem" ("cartId");

-- A line is a listing OR a combo. Never both, never neither. Prisma cannot say
-- this, so the database does - a half-filled line would render as a blank row
-- in somebody's basket with no way to tell what they meant.
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_one_subject"
    CHECK (("listingId" IS NOT NULL) <> ("comboId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 4. WHAT PEOPLE DID IN THE SHOP
-- ===========================================================================
--
-- Deliberately thin, and deliberately NOT a general analytics table: what the
-- shop itself did - viewed, added, removed, asked - with no IP, no device
-- fingerprint and no third-party script. Somebody browsing a security-camera
-- shop is telling you where their blind spots are, and that is not data to
-- collect casually (DPDP 2023).
CREATE TABLE IF NOT EXISTS "CatalogueEvent" (
  "id"           TEXT         NOT NULL,
  "storeId"      TEXT         NOT NULL,
  "kind"         TEXT         NOT NULL,
  "sessionKey"   TEXT         NOT NULL,
  "partyId"      TEXT,
  "listingId"    TEXT,
  "comboId"      TEXT,
  "cartId"       TEXT,
  "at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt"    TIMESTAMP(3),
  "deletedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogueEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogueEvent_storeId_at_idx"
  ON "CatalogueEvent" ("storeId", "at");
CREATE INDEX IF NOT EXISTS "CatalogueEvent_storeId_kind_at_idx"
  ON "CatalogueEvent" ("storeId", "kind", "at");
CREATE INDEX IF NOT EXISTS "CatalogueEvent_sessionKey_idx"
  ON "CatalogueEvent" ("sessionKey");

-- ===========================================================================
-- 5. THEY MADE THE ACCOUNT THEMSELVES
-- ===========================================================================
--
-- Every other "portal*" column is switched on by a staff member for somebody
-- who is already a customer. Decision 9 opens a second door: a visitor can
-- register in order to ask for something, and they are not a customer yet -
-- nobody has met them, nothing has been sold, and the address they typed has
-- never been visited.
--
-- Recorded rather than smoothed over, so a self-registered party cannot
-- silently become a trusted customer record. Every existing party stays NULL,
-- which is the truth: staff created all of them.
ALTER TABLE "Party"
  ADD COLUMN IF NOT EXISTS "selfRegisteredAt" TIMESTAMP(3);

-- ===========================================================================
-- 6. FOREIGN KEYS
-- ===========================================================================
DO $$ BEGIN
  ALTER TABLE "CatalogueListing" ADD CONSTRAINT "CatalogueListing_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueListing" ADD CONSTRAINT "CatalogueListing_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueImage" ADD CONSTRAINT "CatalogueImage_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "CatalogueListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueCombo" ADD CONSTRAINT "CatalogueCombo_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueComboItem" ADD CONSTRAINT "CatalogueComboItem_comboId_fkey"
    FOREIGN KEY ("comboId") REFERENCES "CatalogueCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueComboItem" ADD CONSTRAINT "CatalogueComboItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Cart" ADD CONSTRAINT "Cart_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Cart" ADD CONSTRAINT "Cart_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Cart" ADD CONSTRAINT "Cart_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Cart" ADD CONSTRAINT "Cart_complaintId_fkey"
    FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "CatalogueListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_comboId_fkey"
    FOREIGN KEY ("comboId") REFERENCES "CatalogueCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CatalogueEvent" ADD CONSTRAINT "CatalogueEvent_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogueEvent" ADD CONSTRAINT "CatalogueEvent_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 7. THE AUDIT TRIGGER ON EVERY NEW TABLE
-- ===========================================================================
--
-- Required by audit-coverage.test.ts. `CatalogueEvent` is included although it
-- is itself a log: it is still business data somebody could quietly edit, and
-- "the shop said nobody looked at that product" is exactly the kind of claim
-- worth being able to check.
DROP TRIGGER IF EXISTS atlas_audit ON "CatalogueListing";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CatalogueListing"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CatalogueImage";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CatalogueImage"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CatalogueCombo";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CatalogueCombo"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CatalogueComboItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CatalogueComboItem"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "Cart";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "Cart"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CartItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CartItem"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "CatalogueEvent";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "CatalogueEvent"
  FOR EACH ROW EXECUTE FUNCTION atlas_audit();
