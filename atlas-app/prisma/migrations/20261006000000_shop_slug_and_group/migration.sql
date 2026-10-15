-- Shop addresses per business, and shop headings per listing (3 Oct 2026).
-- Expand-only: two nullable columns and one unique index. Nothing existing changes.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "shopSlug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_shopSlug_key" ON "Organization"("shopSlug");

ALTER TABLE "CatalogueListing" ADD COLUMN IF NOT EXISTS "shopGroup" TEXT;
