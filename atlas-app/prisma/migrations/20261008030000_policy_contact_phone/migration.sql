-- The WhatsApp number a renewal reminder goes to (6 Oct 2026), kept on the
-- policy itself. A company policy has no client to read a number from, which
-- is why the WhatsApp button used to stop and ask for one every time.
-- Additive and nullable: nothing existing changes.
ALTER TABLE "PolicyRenewal" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
