-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIfsc" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "bankAccountNumber" TEXT;

-- AlterTable
ALTER TABLE "SalaryComponent" ADD COLUMN     "employerRatePct" DECIMAL(5,2),
ADD COLUMN     "oneTimePeriodStart" TIMESTAMP(3),
ADD COLUMN     "overtimeKind" TEXT,
ADD COLUMN     "unitRatePaise" INTEGER;

-- CreateTable
CREATE TABLE "SalaryComponentCondition" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SalaryComponentCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryComponentCondition_componentId_idx" ON "SalaryComponentCondition"("componentId");

-- AddForeignKey
ALTER TABLE "SalaryComponentCondition" ADD CONSTRAINT "SalaryComponentCondition_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SalaryComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
