-- CreateTable
CREATE TABLE "SalaryContract" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractType" TEXT NOT NULL DEFAULT 'permanent',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "ctcAnnualPaise" INTEGER NOT NULL,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "esicApplicable" BOOLEAN NOT NULL DEFAULT false,
    "ptApplicable" BOOLEAN NOT NULL DEFAULT true,
    "taxRegime" TEXT NOT NULL DEFAULT 'new',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyPaise" INTEGER NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollConfiguration" (
    "storeId" TEXT NOT NULL,
    "pfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pfEmployeeRatePct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "pfEmployerRatePct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "pfWageCeilingPaise" INTEGER NOT NULL DEFAULT 1500000,
    "esicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "esicEmployeeRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    "esicEmployerRatePct" DECIMAL(5,2) NOT NULL DEFAULT 3.25,
    "esicWageThresholdPaise" INTEGER NOT NULL DEFAULT 2100000,
    "ptEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ptSlabs" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollConfiguration_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "designation" TEXT,
    "workingDays" INTEGER NOT NULL,
    "paidDays" DECIMAL(4,1) NOT NULL,
    "lopDays" DECIMAL(4,1) NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "totalDeductionsPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "paymentRef" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLoan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "principalPaise" INTEGER NOT NULL,
    "emiPaise" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "startPeriod" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disbursalTransactionId" TEXT,
    "approvedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLoanRepayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "payslipId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "transactionId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLoanRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEncashment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "days" DECIMAL(4,1) NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "payslipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveEncashment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementClaim" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "receiptPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTaxDeclaration" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'new',
    "declarations" JSONB NOT NULL DEFAULT '{}',
    "proofStatus" TEXT NOT NULL DEFAULT 'pending',
    "totalDeclaredPaise" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeTaxDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryContract_storeId_userId_effectiveFrom_idx" ON "SalaryContract"("storeId", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryComponent_contractId_idx" ON "SalaryComponent"("contractId");

-- CreateIndex
CREATE INDEX "PayrollRun_storeId_status_idx" ON "PayrollRun"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_storeId_periodStart_key" ON "PayrollRun"("storeId", "periodStart");

-- CreateIndex
CREATE INDEX "Payslip_storeId_userId_idx" ON "Payslip"("storeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrollRunId_userId_key" ON "Payslip"("payrollRunId", "userId");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");

-- CreateIndex
CREATE INDEX "StaffLoan_storeId_userId_status_idx" ON "StaffLoan"("storeId", "userId", "status");

-- CreateIndex
CREATE INDEX "StaffLoanRepayment_loanId_idx" ON "StaffLoanRepayment"("loanId");

-- CreateIndex
CREATE INDEX "LeaveEncashment_storeId_userId_status_idx" ON "LeaveEncashment"("storeId", "userId", "status");

-- CreateIndex
CREATE INDEX "ReimbursementClaim_storeId_userId_status_idx" ON "ReimbursementClaim"("storeId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeTaxDeclaration_storeId_userId_financialYear_key" ON "IncomeTaxDeclaration"("storeId", "userId", "financialYear");

-- AddForeignKey
ALTER TABLE "SalaryContract" ADD CONSTRAINT "SalaryContract_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryContract" ADD CONSTRAINT "SalaryContract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryComponent" ADD CONSTRAINT "SalaryComponent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SalaryContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollConfiguration" ADD CONSTRAINT "PayrollConfiguration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLoanRepayment" ADD CONSTRAINT "StaffLoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "StaffLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEncashment" ADD CONSTRAINT "LeaveEncashment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementClaim" ADD CONSTRAINT "ReimbursementClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTaxDeclaration" ADD CONSTRAINT "IncomeTaxDeclaration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTaxDeclaration" ADD CONSTRAINT "IncomeTaxDeclaration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
