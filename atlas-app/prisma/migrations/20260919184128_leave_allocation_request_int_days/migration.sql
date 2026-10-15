/*
  Warnings:

  - You are about to alter the column `requestedDays` on the `LeaveAllocationRequest` table. The data in that column could be lost. The data in that column will be cast from `Decimal(4,1)` to `Integer`.

*/
-- AlterTable
ALTER TABLE "LeaveAllocationRequest" ALTER COLUMN "requestedDays" SET DATA TYPE INTEGER;
