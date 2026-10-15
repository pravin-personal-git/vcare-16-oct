-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "isBadDebt" BOOLEAN NOT NULL DEFAULT false;
