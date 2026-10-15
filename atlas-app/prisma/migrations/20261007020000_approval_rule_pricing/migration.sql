-- Discount and margin as approval conditions for quotations and invoices
-- (5 Oct 2026). Additive and nullable: existing rules are unchanged.
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "maxDiscountPct" DOUBLE PRECISION;
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "minMarginPct" DOUBLE PRECISION;
