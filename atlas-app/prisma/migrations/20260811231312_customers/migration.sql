-- CreateTable
CREATE TABLE "CustomerType" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CustomerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "companyName" TEXT,
    "gstin" TEXT,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "designation" TEXT,
    "phone" TEXT NOT NULL,
    "phoneCc" TEXT NOT NULL DEFAULT '+91',
    "altPhone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "customerTypeId" TEXT,
    "source" TEXT,
    "customerSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedManagerId" TEXT,
    "birthday" TIMESTAMP(3),
    "weddingAnniversary" TIMESTAMP(3),
    "addressLine1" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "deliveryAddress" TEXT,
    "deliverySameAsBilling" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "locationNote" TEXT,
    "creditLimitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditLimitDays" INTEGER NOT NULL DEFAULT 0,
    "subscribeSms" BOOLEAN NOT NULL DEFAULT true,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "currentBalancePaise" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastPurchaseAt" TIMESTAMP(3),
    "lastCommunicationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerType_storeId_name_key" ON "CustomerType"("storeId", "name");

-- CreateIndex
CREATE INDEX "Customer_storeId_status_idx" ON "Customer"("storeId", "status");

-- CreateIndex
CREATE INDEX "Customer_storeId_phone_idx" ON "Customer"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_customerCode_key" ON "Customer"("storeId", "customerCode");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "CustomerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
