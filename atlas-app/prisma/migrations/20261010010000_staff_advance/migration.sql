-- Salary advances live on StaffLoan (9 Oct 2026).
--
-- A salary advance IS a loan, usually of one instalment, so it belongs on the
-- same model rather than a second one. `kind` exists only so a report can tell
-- them apart and so the form can offer the right defaults. Before this, an
-- advance had nowhere to live except a bare StaffTransaction, which nothing
-- ever collected.
--
-- `loanNo` carries the document number - LN-... for a loan, ADV-... for an
-- advance. Null on rows raised before numbering existed; the screen falls back
-- to the kind and the date.
--
-- Additive, with a default: every existing row is a loan, which it is.
ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "kind"   TEXT NOT NULL DEFAULT 'loan';
ALTER TABLE "StaffLoan" ADD COLUMN IF NOT EXISTS "loanNo" TEXT;

CREATE INDEX IF NOT EXISTS "StaffLoan_storeId_kind_idx" ON "StaffLoan"("storeId", "kind");

-- The owner's own fields on an expense voucher (9 Oct 2026) - a bill number, a
-- vehicle, a meter reading. Defined per branch at Settings > Custom Fields >
-- Office expenses, the same mechanism customers, leads and products use.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
