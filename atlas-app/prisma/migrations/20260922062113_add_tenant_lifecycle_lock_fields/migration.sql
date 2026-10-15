-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lockReason" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "scheduledLockAt" TIMESTAMP(3),
ADD COLUMN     "unlockedAt" TIMESTAMP(3),
ADD COLUMN     "unlockedBy" TEXT;

-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN     "lockReason" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "scheduledLockAt" TIMESTAMP(3),
ADD COLUMN     "unlockedAt" TIMESTAMP(3),
ADD COLUMN     "unlockedBy" TEXT;
