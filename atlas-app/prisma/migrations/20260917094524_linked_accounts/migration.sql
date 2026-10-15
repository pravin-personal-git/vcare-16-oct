-- CreateTable
CREATE TABLE "LinkedAccount" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "linkedUserId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedAccount_ownerUserId_idx" ON "LinkedAccount"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedAccount_ownerUserId_linkedUserId_key" ON "LinkedAccount"("ownerUserId", "linkedUserId");

-- AddForeignKey
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
