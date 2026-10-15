-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "legalEntityId" TEXT;

-- CreateIndex
CREATE INDEX "Store_legalEntityId_idx" ON "Store"("legalEntityId");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
