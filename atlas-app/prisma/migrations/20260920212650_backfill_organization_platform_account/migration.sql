-- Hand-written data migration, sequenced between
-- `add_platform_rbac_and_org_fields` and the follow-up that tightens
-- `Organization.platformAccountId` to required.
--
-- Self-contained SQL, not a standalone TypeScript script, so
-- `prisma migrate deploy` (run unattended by the Vercel build) backfills
-- every existing Organization onto the single root PLATFORM account by
-- itself - same reasoning as `20260920192850_backfill_legal_entity_data`,
-- which fixed the exact failure mode this would otherwise repeat (the
-- NOT NULL migration failing against real rows on a database that has
-- never run these migrations before, e.g. production).
--
-- Idempotent: only touches rows where platformAccountId IS NULL, so
-- re-running (or running against dev, where the root account already
-- exists but nothing pointed at it yet) is safe.

UPDATE "Organization"
SET "platformAccountId" = (
  SELECT id FROM "PlatformAccount"
  WHERE type = 'PLATFORM' AND "parentAccountId" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "platformAccountId" IS NULL;
