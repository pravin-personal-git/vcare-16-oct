-- A branch's own document layout (workstream C, 1 Oct 2026).
--
-- Quotation templates were "never built" - there was one hardcoded printable
-- page. Pravin's decision: two finished defaults, plus a third path where the
-- client builds their own.
--
-- The two defaults live in code (lib/document-templates) because they must be
-- identical everywhere and are part of the product. This table holds only the
-- client's own options and which layout each document type uses.
--
-- One row per branch per docType, so a formal quotation and a plain invoice
-- can look different - which is what businesses actually do.
CREATE TABLE IF NOT EXISTS "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "templateId" TEXT NOT NULL DEFAULT 'classic',
    "options" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentTemplate_storeId_docType_key"
    ON "DocumentTemplate"("storeId", "docType");

ALTER TABLE "DocumentTemplate"
    ADD CONSTRAINT "DocumentTemplate_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What a customer's document looked like is a thing people dispute later.
DROP TRIGGER IF EXISTS atlas_audit ON "DocumentTemplate";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DocumentTemplate" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
