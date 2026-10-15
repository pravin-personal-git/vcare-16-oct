-- CreateTable
CREATE TABLE "EmployeeSalary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "basicPaise" INTEGER NOT NULL,
    "hraPaise" INTEGER NOT NULL DEFAULT 0,
    "allowancesPaise" INTEGER NOT NULL DEFAULT 0,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "esicApplicable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSalary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalary_userId_key" ON "EmployeeSalary"("userId");

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
