-- Held actions (5 Oct 2026): an action that needs approval - cancel an invoice,
-- refund a customer, pay a supplier - is saved with what it will do and run
-- only once approved. Additive and nullable: nothing existing changes.
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "payload" JSONB;
