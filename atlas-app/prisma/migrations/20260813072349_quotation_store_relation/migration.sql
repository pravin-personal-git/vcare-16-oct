-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
