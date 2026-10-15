-- MAALIK OS device trust: the phone record gains the anti-cheat fields, every
-- change is logged in DeviceEvent, and pairing gets its own permission.

-- AlterTable
ALTER TABLE "CallSyncDevice" ADD COLUMN     "androidId" TEXT,
ADD COLUMN     "appRemovedAt" TIMESTAMP(3),
ADD COLUMN     "clockSkewMs" INTEGER,
ADD COLUMN     "integrityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "integrityVerdict" TEXT,
ADD COLUMN     "lastIp" TEXT,
ADD COLUMN     "mockLocationSeenAt" TIMESTAMP(3),
ADD COLUMN     "permissionState" JSONB,
ADD COLUMN     "pushToken" TEXT;

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceEvent_storeId_createdAt_idx" ON "DeviceEvent"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_createdAt_idx" ON "DeviceEvent"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CallSyncDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- "Pair phones" permission. Admin (system) roles receive it from the tenant
-- defaults sync that runs on every deploy. Here: every other role that can
-- already pair phones today (calls.manage) keeps that ability. Idempotent.
INSERT INTO "Permission" ("id", "key", "module", "action")
SELECT gen_random_uuid()::text, 'devices.pair', 'devices', 'pair'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "key" = 'devices.pair');

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", dp."id"
FROM "RolePermission" rp
JOIN "Permission" cm ON cm."id" = rp."permissionId" AND cm."key" = 'calls.manage'
CROSS JOIN (SELECT "id" FROM "Permission" WHERE "key" = 'devices.pair') dp
ON CONFLICT DO NOTHING;
