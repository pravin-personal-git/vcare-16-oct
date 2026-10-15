-- Hand-written, sequenced between `add_platform_rbac_and_org_fields` and
-- `backfill_organization_platform_account`.
--
-- The single root PLATFORM `PlatformAccount` row (and the `PlatformConfig`
-- singleton) were only ever created by a standalone script
-- (`backfill-platform-root.ts`) run by hand against dev, or by `seed.ts`
-- (dev-only, guarded against production) - never by anything in the
-- automated Vercel build pipeline (`prisma migrate deploy` then
-- `sync-tenant-defaults.ts`). Confirmed while preparing this deploy:
-- production has the `PlatformAccount` TABLE (from Slice 1's migration)
-- but ZERO rows in it. Without this migration, the very next one
-- (`backfill_organization_platform_account`) would find no root to point
-- existing Organizations at, and the one after that
-- (`require_organization_platform_account`, `SET NOT NULL`) would fail
-- against real rows on a database with no backup - the exact failure mode
-- `20260920192850_backfill_legal_entity_data` already fixed once for
-- LegalEntity; this is the same lesson applied to PlatformAccount.
--
-- Idempotent: both inserts are guarded by `WHERE NOT EXISTS`, so this is a
-- safe no-op on dev, where the root row already exists.

INSERT INTO "PlatformAccount"
  (id, type, "parentAccountId", "rootPlatformId", path, name, "accountCode", "lifecycleState", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'PLATFORM', NULL, '', '', 'Atlas Platform', 'PLATFORM-ROOT', 'ACTIVE', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "PlatformAccount" WHERE type = 'PLATFORM' AND "parentAccountId" IS NULL
);

-- Self-reference rootPlatformId/path onto its own id, now that the row (and
-- therefore its id) exists. Only touches a row this same migration just
-- created (path/rootPlatformId still the placeholder empty string) -
-- leaves an existing, already-correct root row on dev untouched.
UPDATE "PlatformAccount"
SET "rootPlatformId" = id, path = id
WHERE type = 'PLATFORM' AND "parentAccountId" IS NULL AND path = '';

INSERT INTO "PlatformConfig" (id, "maxResellerDepth", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "PlatformConfig");
