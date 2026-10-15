-- Hand-written data migration for D046 (LegalEntity), sequenced between
-- `add_store_legal_entity_nullable` and `require_store_legal_entity`.
--
-- Makes the SQL equivalent of `backfill-legal-entity.ts` and
-- `backfill-store-legal-entity.ts` part of the migration chain itself,
-- instead of depending on a human running those scripts by hand in the
-- right window. Those scripts already did this job against the dev
-- database directly; this migration exists so `prisma migrate deploy`
-- (run unattended by the Vercel build) can apply the WHOLE chain against
-- a database seeing these migrations for the first time - e.g. production -
-- without the very next migration (`require_store_legal_entity`, which sets
-- `Store.legalEntityId` NOT NULL) failing against real NULL rows.
--
-- Fully idempotent - every statement is guarded, so running this again on
-- dev (where the equivalent TypeScript backfills already ran) is a no-op.

-- 1. One default LegalEntity per Organization that doesn't already have one.
INSERT INTO "LegalEntity" (id, "organizationId", name, gstin, status, "approvedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o.id, o.name, o.gstin, 'APPROVED', now(), now(), now()
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "LegalEntity" le WHERE le."organizationId" = o.id);

-- 2. Every Store without a legalEntityId gets its organisation's earliest
--    LegalEntity (the row just created above, or a pre-existing one on dev).
UPDATE "Store" s
SET "legalEntityId" = (
  SELECT le.id FROM "LegalEntity" le
  WHERE le."organizationId" = s."organizationId"
  ORDER BY le."createdAt" ASC
  LIMIT 1
)
WHERE s."legalEntityId" IS NULL;
