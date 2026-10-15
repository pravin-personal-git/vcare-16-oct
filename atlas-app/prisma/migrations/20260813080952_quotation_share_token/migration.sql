/*
  Warnings:

  - A unique constraint covering the columns `[publicToken]` on the table `Quotation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_publicToken_key" ON "Quotation"("publicToken");
