/*
  Warnings:

  - Added the required column `updatedAt` to the `LeadNote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'note',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "LeadNote_leadId_kind_idx" ON "LeadNote"("leadId", "kind");
