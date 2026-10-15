-- Page customisation, admin only (11 Oct 2026, pages build area I).
-- Expand-only: a new table.
CREATE TABLE "UiCustomisation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'everyone',
    "roleId" TEXT,
    "userId" TEXT,
    "json" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    CONSTRAINT "UiCustomisation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UiCustomisation_storeId_page_idx" ON "UiCustomisation"("storeId", "page");
ALTER TABLE "UiCustomisation" ADD CONSTRAINT "UiCustomisation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who changed a page's layout for everyone is worth a record.
DROP TRIGGER IF EXISTS atlas_audit ON "UiCustomisation";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UiCustomisation" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
