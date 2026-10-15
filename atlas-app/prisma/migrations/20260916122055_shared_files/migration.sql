-- CreateTable
CREATE TABLE "SharedFile" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedFile_storeId_folder_idx" ON "SharedFile"("storeId", "folder");

-- AddForeignKey
ALTER TABLE "SharedFile" ADD CONSTRAINT "SharedFile_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
