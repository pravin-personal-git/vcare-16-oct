-- A3 (12 Oct 2026): documents sent as a PDF through the WhatsApp Business
-- Cloud API, and what became of each - sent, delivered, read, failed - as
-- Meta's webhook reports it. Expand-only: one new table.
CREATE TABLE IF NOT EXISTS "DocumentSend" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "toName" TEXT,
    "toPhone" TEXT NOT NULL,
    "templateName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "providerRef" TEXT,
    "error" TEXT,
    "sentBy" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "DocumentSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocumentSend_storeId_docType_docId_idx" ON "DocumentSend"("storeId", "docType", "docId");
CREATE INDEX IF NOT EXISTS "DocumentSend_providerRef_idx" ON "DocumentSend"("providerRef");
DO $$ BEGIN
  ALTER TABLE "DocumentSend" ADD CONSTRAINT "DocumentSend_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who sent which document, and when, is audited.
DROP TRIGGER IF EXISTS atlas_audit ON "DocumentSend";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "DocumentSend" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
