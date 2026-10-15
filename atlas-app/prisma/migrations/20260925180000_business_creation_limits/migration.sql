-- Creating a new business is a paid-plan capability (founder decision,
-- 25 Sep 2026): off by default, switched on per tenant by the Platform Owner.
ALTER TABLE "Organization" ALTER COLUMN "allowSelfServiceBusinessCreation" SET DEFAULT false;
UPDATE "Organization" SET "allowSelfServiceBusinessCreation" = false;

ALTER TABLE "Organization" ADD COLUMN "businessLimit" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "branchLimit" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "createdFromOrganizationId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "createdByUserId" TEXT;

-- Backfill where a business was made through "Create a new business": that
-- path links the caller to the new admin with the business name as label,
-- within moments of the business being created.
UPDATE "Organization" o
SET "createdFromOrganizationId" = owner."organizationId",
    "createdByUserId" = la."ownerUserId"
FROM "LinkedAccount" la
JOIN "User" admin ON admin."id" = la."linkedUserId"
JOIN "User" owner ON owner."id" = la."ownerUserId"
WHERE admin."organizationId" = o."id"
  AND la."label" = o."name"
  AND owner."organizationId" IS NOT NULL
  AND owner."organizationId" <> o."id"
  AND abs(extract(epoch FROM (admin."createdAt" - o."createdAt"))) < 600
  AND o."createdFromOrganizationId" IS NULL;
