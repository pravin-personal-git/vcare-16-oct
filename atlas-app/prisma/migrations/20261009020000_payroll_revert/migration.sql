-- Payroll revert (8 Oct 2026). A processed run can be taken back to draft so a
-- mistake found afterwards can be corrected and the month rebuilt: the ledger
-- entries are reversed (never deleted) and the loan repayments the run
-- collected are removed, so the EMI is not taken twice.
-- Additive and nullable: nothing existing changes.
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "revertedAt"   TIMESTAMP(3);
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "revertedBy"   TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "revertReason" TEXT;
