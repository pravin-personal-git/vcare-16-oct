-- Plan and entitlement per tenant (workstream F, 1 Oct 2026).
--
-- The platform owner's half of configuration. Everything else in this roadmap
-- lets a CLIENT configure their own Atlas; this is the layer above - what
-- Pravin allows each client to have at all.
--
-- It is applied in server/context.ts BEFORE role and user menu visibility, so
-- a client switching a module on in their own settings cannot grant
-- themselves something their plan excludes.
--
-- Defaults are deliberately the most generous: every existing tenant lands on
-- "full" with no cap, which is exactly what they had yesterday. A plan change
-- has to be a decision somebody makes, never something a migration does.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "planId" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "userLimit" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "excludedModules" JSONB;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
