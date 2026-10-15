/*
  Warnings:

  - You are about to drop the column `url` on the `DocumentAttachment` table. All the data in the column will be lost.
  - Added the required column `storagePath` to the `DocumentAttachment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DocumentAttachment" DROP COLUMN "url",
ADD COLUMN     "storagePath" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "poNumber" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "poNumber" TEXT;
