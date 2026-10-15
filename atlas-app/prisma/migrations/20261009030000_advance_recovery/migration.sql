-- Recover plain staff advances from salary (8 Oct 2026, G-19). Until now the
-- only recoverable deduction on a payslip was a loan EMI, so money handed over
-- without a loan schedule sat on 1400 Staff Advances for ever and nobody
-- noticed until the person left.
--
-- OFF by default: switching it on changes what people are paid, and that is a
-- decision rather than a default. Additive, with defaults, so nothing existing
-- changes.
ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "advanceRecoveryEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PayrollConfiguration" ADD COLUMN IF NOT EXISTS "advanceRecoveryMaxPaise" INTEGER NOT NULL DEFAULT 0;
