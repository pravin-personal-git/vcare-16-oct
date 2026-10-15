-- CreateTable
CREATE TABLE "StaffChecklistItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffChecklistEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT,
    "legacyRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffChecklistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffChecklistItem_storeId_key_key" ON "StaffChecklistItem"("storeId", "key");

-- CreateIndex
CREATE INDEX "StaffChecklistEntry_storeId_workDate_idx" ON "StaffChecklistEntry"("storeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChecklistEntry_storeId_userId_workDate_key" ON "StaffChecklistEntry"("storeId", "userId", "workDate");

-- AddForeignKey
ALTER TABLE "StaffChecklistItem" ADD CONSTRAINT "StaffChecklistItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChecklistEntry" ADD CONSTRAINT "StaffChecklistEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChecklistEntry" ADD CONSTRAINT "StaffChecklistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit trail (AUD-1) on the new tables.
DROP TRIGGER IF EXISTS atlas_audit ON "StaffChecklistItem";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StaffChecklistItem" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StaffChecklistEntry";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StaffChecklistEntry" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
