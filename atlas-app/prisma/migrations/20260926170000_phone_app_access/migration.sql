-- Phone app access per role and per person (26 Sep 2026, PHONE-APP-ACCESS-SPEC.md). Expand-only.
-- NOTE: prisma migrate diff also proposes DROP INDEX "RepairChallan_assigneeIds_idx" - hand-made GIN index, left out on purpose.


-- CreateTable
CREATE TABLE "RoleAppAccess" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAppAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAppAccess" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAppAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleAppAccess_roleId_key" ON "RoleAppAccess"("roleId");

-- CreateIndex
CREATE INDEX "RoleAppAccess_storeId_idx" ON "RoleAppAccess"("storeId");

-- CreateIndex
CREATE INDEX "UserAppAccess_userId_idx" ON "UserAppAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAppAccess_storeId_userId_key" ON "UserAppAccess"("storeId", "userId");

-- AddForeignKey
ALTER TABLE "RoleAppAccess" ADD CONSTRAINT "RoleAppAccess_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAppAccess" ADD CONSTRAINT "RoleAppAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAppAccess" ADD CONSTRAINT "UserAppAccess_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAppAccess" ADD CONSTRAINT "UserAppAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit trail, like every business table (audit-coverage.test.ts).
DROP TRIGGER IF EXISTS atlas_audit ON "RoleAppAccess";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RoleAppAccess" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "UserAppAccess";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserAppAccess" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
