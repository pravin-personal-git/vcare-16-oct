-- Configurability: elements, flow steps and the delegate queue (29 Sep 2026,
-- CONFIGURABILITY-SPEC.md, decisions D15 and D16). Expand-only.
--
-- These sit BESIDE RoleAppAccess/UserAppAccess, which keep a live client's
-- phone settings working unchanged. The key catalogue in lib/config-registry.ts
-- adopts the phone's keys, so these tables hold the same flat shape and the
-- eventual fold-in is a copy rather than a translation. Contract in a later
-- release (AGENTS.md §6).

-- CreateTable
CREATE TABLE "StoreConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "flow" JSONB NOT NULL DEFAULT '{}',
    "labels" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "flow" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "flow" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "needsPermission" TEXT NOT NULL,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreConfig_storeId_key" ON "StoreConfig"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleConfig_roleId_key" ON "RoleConfig"("roleId");

-- CreateIndex
CREATE INDEX "RoleConfig_storeId_idx" ON "RoleConfig"("storeId");

-- CreateIndex
CREATE INDEX "UserConfig_userId_idx" ON "UserConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserConfig_storeId_userId_key" ON "UserConfig"("storeId", "userId");

-- CreateIndex
CREATE INDEX "StepRequest_storeId_status_createdAt_idx" ON "StepRequest"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StepRequest_refType_refId_idx" ON "StepRequest"("refType", "refId");

-- AddForeignKey
ALTER TABLE "StoreConfig" ADD CONSTRAINT "StoreConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleConfig" ADD CONSTRAINT "RoleConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleConfig" ADD CONSTRAINT "RoleConfig_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConfig" ADD CONSTRAINT "UserConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConfig" ADD CONSTRAINT "UserConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequest" ADD CONSTRAINT "StepRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequest" ADD CONSTRAINT "StepRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRequest" ADD CONSTRAINT "StepRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Audit trail, like every business table (audit-coverage.test.ts). Who changed
-- which switch matters more here than on most tables: a client asking "why can
-- my technician not raise a challan any more" needs an answer.
DROP TRIGGER IF EXISTS atlas_audit ON "StoreConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StoreConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "RoleConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "RoleConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "UserConfig";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "UserConfig" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
DROP TRIGGER IF EXISTS atlas_audit ON "StepRequest";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "StepRequest" FOR EACH ROW EXECUTE FUNCTION atlas_audit();


-- The sidebar is data, not code (model Menu), so a new screen needs a row in
-- every database that already exists - provision-prod.ts only covers new ones.
-- Idempotent: re-running changes nothing, and a database whose sidebar has been
-- rearranged by hand is left alone rather than being "corrected".
INSERT INTO "Menu" ("id", "parentId", "label", "route", "sort", "platform")
SELECT
  'menu-settings-customisation',
  parent."id",
  'Customisation',
  '/settings/customisation',
  COALESCE((SELECT MAX(child."sort") + 1 FROM "Menu" child WHERE child."parentId" = parent."id"), 0),
  'WEB'
FROM "Menu" parent
WHERE parent."label" = 'System Settings'
  AND parent."route" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m."route" = '/settings/customisation')
LIMIT 1;

-- Visible wherever its parent is. A store that has switched System Settings off
-- keeps it off; nothing is switched on that was not already on.
INSERT INTO "StoreMenuConfig" ("storeId", "menuId", "isEnabled")
SELECT smc."storeId", 'menu-settings-customisation', smc."isEnabled"
FROM "StoreMenuConfig" smc
JOIN "Menu" parent ON parent."id" = smc."menuId" AND parent."label" = 'System Settings'
WHERE EXISTS (SELECT 1 FROM "Menu" m WHERE m."id" = 'menu-settings-customisation')
ON CONFLICT ("storeId", "menuId") DO NOTHING;
