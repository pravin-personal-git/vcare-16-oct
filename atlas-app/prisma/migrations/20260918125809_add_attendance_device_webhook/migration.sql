-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deviceModel" TEXT,
    "defaultZoneId" TEXT,
    "timezoneOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "fieldMapping" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "lastPunchAt" TIMESTAMP(3),
    "lastCalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_tokenHash_key" ON "AttendanceDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AttendanceDevice_storeId_isActive_idx" ON "AttendanceDevice"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "AttendanceDeviceEvent_deviceId_receivedAt_idx" ON "AttendanceDeviceEvent"("deviceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_defaultZoneId_fkey" FOREIGN KEY ("defaultZoneId") REFERENCES "AttendanceZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDeviceEvent" ADD CONSTRAINT "AttendanceDeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDeviceEvent" ADD CONSTRAINT "AttendanceDeviceEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
