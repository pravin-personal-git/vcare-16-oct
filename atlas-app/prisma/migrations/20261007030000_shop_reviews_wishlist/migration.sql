-- Shop reviews (approved by the business before they show) and wishlists
-- (5 Oct 2026). New tables only; nothing existing changes.
CREATE TABLE IF NOT EXISTS "ProductReview" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "partyId" TEXT,
  "authorName" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "body" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reply" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductReview_listingId_partyId_key" ON "ProductReview"("listingId", "partyId");
CREATE INDEX IF NOT EXISTS "ProductReview_storeId_status_createdAt_idx" ON "ProductReview"("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductReview_listingId_status_idx" ON "ProductReview"("listingId", "status");
ALTER TABLE "ProductReview" DROP CONSTRAINT IF EXISTS "ProductReview_storeId_fkey";
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" DROP CONSTRAINT IF EXISTS "ProductReview_listingId_fkey";
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "CatalogueListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" DROP CONSTRAINT IF EXISTS "ProductReview_partyId_fkey";
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ShopWishlist" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "partyId" TEXT,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "originNodeId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopWishlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShopWishlist_storeId_sessionKey_listingId_key" ON "ShopWishlist"("storeId", "sessionKey", "listingId");
CREATE INDEX IF NOT EXISTS "ShopWishlist_storeId_listingId_idx" ON "ShopWishlist"("storeId", "listingId");
CREATE INDEX IF NOT EXISTS "ShopWishlist_partyId_idx" ON "ShopWishlist"("partyId");
ALTER TABLE "ShopWishlist" DROP CONSTRAINT IF EXISTS "ShopWishlist_storeId_fkey";
ALTER TABLE "ShopWishlist" ADD CONSTRAINT "ShopWishlist_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopWishlist" DROP CONSTRAINT IF EXISTS "ShopWishlist_listingId_fkey";
ALTER TABLE "ShopWishlist" ADD CONSTRAINT "ShopWishlist_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "CatalogueListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS atlas_audit ON "ProductReview";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ProductReview" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "ShopWishlist";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "ShopWishlist" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
