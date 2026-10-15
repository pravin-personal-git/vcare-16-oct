-- Attachments that do something (11 Oct 2026, pages build area H).
-- Expand-only: new nullable / defaulted columns, nothing renamed or dropped.
ALTER TABLE "DocumentAttachment" ADD COLUMN "tag" TEXT;
ALTER TABLE "DocumentAttachment" ADD COLUMN "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentAttachment" ADD COLUMN "replacedById" TEXT;
ALTER TABLE "DocumentAttachment" ADD COLUMN "extracted" JSONB;
ALTER TABLE "DocumentAttachment" ADD COLUMN "removedReason" TEXT;
