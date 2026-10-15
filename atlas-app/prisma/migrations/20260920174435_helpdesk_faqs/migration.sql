-- CreateTable
CREATE TABLE "HelpdeskFaqCategory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpdeskFaqCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskFaq" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskFaq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskFaqCategory_storeId_title_key" ON "HelpdeskFaqCategory"("storeId", "title");

-- CreateIndex
CREATE INDEX "HelpdeskFaq_storeId_categoryId_idx" ON "HelpdeskFaq"("storeId", "categoryId");

-- AddForeignKey
ALTER TABLE "HelpdeskFaqCategory" ADD CONSTRAINT "HelpdeskFaqCategory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskFaq" ADD CONSTRAINT "HelpdeskFaq_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskFaq" ADD CONSTRAINT "HelpdeskFaq_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpdeskFaqCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
