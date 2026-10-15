-- F-13 (13 Oct 2026): phone actions from MAALIK OS's offline outbox, applied
-- once each. Expand-only: one new table.
CREATE TABLE IF NOT EXISTS "PhoneOp" (
    "id" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneOp_opId_key" ON "PhoneOp"("opId");
CREATE INDEX IF NOT EXISTS "PhoneOp_userId_createdAt_idx" ON "PhoneOp"("userId", "createdAt");

