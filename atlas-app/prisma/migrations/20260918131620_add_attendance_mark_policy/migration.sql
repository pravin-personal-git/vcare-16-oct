-- CreateTable
CREATE TABLE "AttendanceMarkPolicy" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "restrictToRules" BOOLEAN NOT NULL DEFAULT false,
    "selfMarkingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "managerMarksReports" BOOLEAN NOT NULL DEFAULT true,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceMarkPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMarkPolicy_storeId_key" ON "AttendanceMarkPolicy"("storeId");

-- AddForeignKey
ALTER TABLE "AttendanceMarkPolicy" ADD CONSTRAINT "AttendanceMarkPolicy_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
