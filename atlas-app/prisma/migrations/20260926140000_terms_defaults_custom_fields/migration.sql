-- T&C defaults and owner-defined fields on customers, leads, products (26 Sep 2026). Expand-only.
-- NOTE: prisma migrate diff also proposes DROP INDEX "RepairChallan_assigneeIds_idx" - hand-made GIN index, left out on purpose.


-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "TncTemplate" ADD COLUMN     "defaultFor" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "EntityFieldConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EntityFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityFieldConfig_storeId_entity_sortOrder_idx" ON "EntityFieldConfig"("storeId", "entity", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EntityFieldConfig_storeId_entity_fieldKey_key" ON "EntityFieldConfig"("storeId", "entity", "fieldKey");

-- AddForeignKey
ALTER TABLE "EntityFieldConfig" ADD CONSTRAINT "EntityFieldConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityFieldConfig" ADD CONSTRAINT "EntityFieldConfig_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Audit trail, like every business table (audit-coverage.test.ts).
DROP TRIGGER IF EXISTS atlas_audit ON "EntityFieldConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "EntityFieldConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
