-- CreateTable
CREATE TABLE "DisciplinaryActionType" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "blockLogin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplinaryActionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryAction" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionTypeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "durationDays" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisciplinaryAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisciplinaryActionType_storeId_idx" ON "DisciplinaryActionType"("storeId");

-- CreateIndex
CREATE INDEX "DisciplinaryAction_storeId_userId_idx" ON "DisciplinaryAction"("storeId", "userId");

-- AddForeignKey
ALTER TABLE "DisciplinaryActionType" ADD CONSTRAINT "DisciplinaryActionType_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryAction" ADD CONSTRAINT "DisciplinaryAction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryAction" ADD CONSTRAINT "DisciplinaryAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryAction" ADD CONSTRAINT "DisciplinaryAction_actionTypeId_fkey" FOREIGN KEY ("actionTypeId") REFERENCES "DisciplinaryActionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
