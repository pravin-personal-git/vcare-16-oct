-- F-01 / F-05, 10 Oct 2026. Both additive, both defaulted, so every existing
-- row keeps today's behaviour the moment this lands: no page is hidden that
-- was not hidden before, and no phone is treated as signed out until it says
-- so. Expand only - nothing is dropped or rewritten.

-- Individual pages the platform owner switched off for one tenant, as routes.
ALTER TABLE "Organization" ADD COLUMN "excludedPages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A phone that signed out of MAALIK OS. It still gets Urgent alerts, but with
-- no business detail in them until somebody signs in again.
ALTER TABLE "PushToken" ADD COLUMN "signedOut" BOOLEAN NOT NULL DEFAULT false;
