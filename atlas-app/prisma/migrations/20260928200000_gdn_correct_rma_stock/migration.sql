-- 28 Sep 2026 (Pravin): the store can cancel a GDN; a replaced old unit's
-- supplier credit note and its return into stock are recorded on the case.
ALTER TABLE "MaterialIssue" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "MaterialIssue" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "MaterialIssue" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN "creditNoteNo" TEXT;
ALTER TABLE "ReplacementCase" ADD COLUMN "creditAmountPaise" INTEGER;
ALTER TABLE "ReplacementCase" ADD COLUMN "stockBookedAt" TIMESTAMP(3);
