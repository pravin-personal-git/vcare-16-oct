-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "portalActivatedAt" TIMESTAMP(3),
ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalFailedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "portalLockedUntil" TIMESTAMP(3),
ADD COLUMN     "portalMustReset" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "portalPasswordHash" TEXT;

-- CreateTable
CREATE TABLE "PartyLoginSession" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "loggedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedOutAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartyLoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartyLoginSession_sessionToken_key" ON "PartyLoginSession"("sessionToken");

-- CreateIndex
CREATE INDEX "PartyLoginSession_partyId_idx" ON "PartyLoginSession"("partyId");

-- AddForeignKey
ALTER TABLE "PartyLoginSession" ADD CONSTRAINT "PartyLoginSession_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
