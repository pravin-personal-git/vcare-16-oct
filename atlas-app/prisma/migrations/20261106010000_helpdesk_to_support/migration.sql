-- Helpdesk tickets can go to the software's own support team (30 Oct 2026).
ALTER TABLE "HelpdeskTicket" ADD COLUMN "toSupport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HelpdeskTicket" ADD COLUMN "sentToSupportAt" TIMESTAMP(3);
ALTER TABLE "HelpdeskTicket" ADD COLUMN "context" JSONB;
ALTER TABLE "HelpdeskComment" ADD COLUMN "fromSupport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HelpdeskComment" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "HelpdeskTicket_toSupport_status_idx" ON "HelpdeskTicket"("toSupport", "status");
