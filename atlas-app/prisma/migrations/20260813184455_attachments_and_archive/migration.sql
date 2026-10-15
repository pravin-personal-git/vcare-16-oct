-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT;

-- CreateTable
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAttachment_storeId_docType_docId_idx" ON "DocumentAttachment"("storeId", "docType", "docId");

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
