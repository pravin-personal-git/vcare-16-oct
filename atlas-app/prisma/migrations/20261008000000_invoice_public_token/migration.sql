-- The customer's no-login invoice link (/i/<token>), 6 Oct 2026. Additive.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_publicToken_key" ON "Invoice"("publicToken");
