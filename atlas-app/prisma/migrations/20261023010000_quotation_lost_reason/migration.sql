-- Dashboards (11 Oct 2026): "Lost" on the Sales dashboard's Quotations to
-- chase asks why. The answer is kept on the quotation so a later report can
-- count the reasons deals are lost. Expand-only: one nullable column.
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
