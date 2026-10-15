-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "actingUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivilegedAccessEvent" (
    "id" TEXT NOT NULL,
    "actingUserId" TEXT NOT NULL,
    "actingMembershipId" TEXT,
    "actionType" TEXT NOT NULL,
    "organizationId" TEXT,
    "targetUserId" TEXT,
    "reason" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PrivilegedAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationSession_token_key" ON "ImpersonationSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationSession_eventId_key" ON "ImpersonationSession"("eventId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_actingUserId_idx" ON "ImpersonationSession"("actingUserId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_organizationId_idx" ON "ImpersonationSession"("organizationId");

-- CreateIndex
CREATE INDEX "PrivilegedAccessEvent_organizationId_idx" ON "PrivilegedAccessEvent"("organizationId");

-- CreateIndex
CREATE INDEX "PrivilegedAccessEvent_actingUserId_idx" ON "PrivilegedAccessEvent"("actingUserId");

-- CreateIndex
CREATE INDEX "PrivilegedAccessEvent_targetUserId_idx" ON "PrivilegedAccessEvent"("targetUserId");

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PrivilegedAccessEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegedAccessEvent" ADD CONSTRAINT "PrivilegedAccessEvent_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegedAccessEvent" ADD CONSTRAINT "PrivilegedAccessEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivilegedAccessEvent" ADD CONSTRAINT "PrivilegedAccessEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
