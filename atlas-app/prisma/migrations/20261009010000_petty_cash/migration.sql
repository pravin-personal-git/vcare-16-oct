-- Petty cash (8 Oct 2026). Who the cash was handed to on an expense voucher -
-- informational, no ledger effect, so nobody becomes a debtor for the chai
-- they bought for the office. Additive and nullable.
--
-- The two new expense accounts (5800 Staff Welfare & Refreshments, 5850
-- Vehicle & Fuel) and 1030 Petty Cash are created per organisation by
-- prisma/sync-tenant-defaults.ts, which the deploy build runs - they are not
-- in this file because accounts are rows, not columns.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paidToUserId" TEXT;
