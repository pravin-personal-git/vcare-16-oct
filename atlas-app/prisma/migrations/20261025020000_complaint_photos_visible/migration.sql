-- Job photos the portal already showed stay visible to the customer (11 Oct 2026).
-- The portal now follows DocumentAttachment.visibleToCustomer.
UPDATE "DocumentAttachment" SET "visibleToCustomer" = true WHERE "docType" = 'complaint' AND "mimeType" LIKE 'image/%';
