-- Email and WhatsApp, per branch, per provider (workstream D, 1 Oct 2026).
--
-- Email was hardcoded to one provider behind a deployment-wide RESEND_API_KEY
-- environment variable - one account shared by every tenant, which cannot
-- deliver "the client picks their provider". WhatsApp did not exist at all.
--
-- THE SECRET RULE, AND WHY THIS IS NOT A CONTRADICTION OF F2.5.
--
-- The biometric connector keeps its vendor password on the client's own PC and
-- `assertNoSecrets` refuses to let one reach this database. That is still
-- right: that process runs on their network and can hold its own secret.
--
-- Email and WhatsApp are called from OUR server on the client's behalf. There
-- is no client-side process to hold the key, and an environment variable is
-- per-deployment rather than per-tenant. So the key must live with the tenant
-- row - and therefore it is ENCRYPTED, AES-256-GCM, by server/secret-box,
-- with the master key held only in the environment. A stolen dump is
-- ciphertext. The reasoning is written out in that module.
CREATE TABLE IF NOT EXISTS "MessagingChannel" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "fromName" TEXT,
    "fromAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestNote" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "MessagingChannel_pkey" PRIMARY KEY ("id")
);

-- One provider per channel per branch. Two would mean "which one sent it?"
-- has no answer.
CREATE UNIQUE INDEX IF NOT EXISTS "MessagingChannel_storeId_channel_key"
    ON "MessagingChannel"("storeId", "channel");

ALTER TABLE "MessagingChannel"
    ADD CONSTRAINT "MessagingChannel_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who changed the sending account, and when. The audit trigger already hides
-- any column whose name looks like a secret, so the sealed credential is
-- recorded as "(hidden)" rather than copied into the audit row.
DROP TRIGGER IF EXISTS atlas_audit ON "MessagingChannel";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "MessagingChannel" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
