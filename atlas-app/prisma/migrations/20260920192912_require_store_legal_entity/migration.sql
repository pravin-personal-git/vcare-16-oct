/*
  Warnings:

  - Made the column `legalEntityId` on table `Store` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "legalEntityId" SET NOT NULL;
