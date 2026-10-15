-- Replace the binary isPaid flag with a 0-100 paidPercentage, so a leave
-- type can draw partial pay (atlas-hrns's payment_percentage), not just
-- fully-paid or fully-unpaid.
ALTER TABLE "LeaveType" ADD COLUMN "paidPercentage" INTEGER NOT NULL DEFAULT 100;

UPDATE "LeaveType" SET "paidPercentage" = 0 WHERE "isPaid" = false;

ALTER TABLE "LeaveType" DROP COLUMN "isPaid";
