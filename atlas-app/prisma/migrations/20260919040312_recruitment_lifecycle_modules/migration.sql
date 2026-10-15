-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'applied',
    "hiredUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateActivity" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "body" TEXT,
    "stageFrom" TEXT,
    "stageTo" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleChecklistItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LifecycleChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleTask" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "checklistItemId" TEXT,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "dateOfJoining" TIMESTAMP(3),
    "employmentType" TEXT NOT NULL DEFAULT 'full_time',
    "personalEmail" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "exitReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resignation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "noticeDays" INTEGER NOT NULL,
    "resignedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWorkingDay" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resignation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOpening_storeId_status_idx" ON "JobOpening"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_hiredUserId_key" ON "Candidate"("hiredUserId");

-- CreateIndex
CREATE INDEX "Candidate_storeId_stage_idx" ON "Candidate"("storeId", "stage");

-- CreateIndex
CREATE INDEX "CandidateActivity_candidateId_createdAt_idx" ON "CandidateActivity"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "LifecycleChecklistItem_storeId_phase_sortOrder_idx" ON "LifecycleChecklistItem"("storeId", "phase", "sortOrder");

-- CreateIndex
CREATE INDEX "LifecycleTask_storeId_userId_phase_idx" ON "LifecycleTask"("storeId", "userId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");

-- CreateIndex
CREATE INDEX "Resignation_storeId_status_idx" ON "Resignation"("storeId", "status");

-- AddForeignKey
ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_hiredUserId_fkey" FOREIGN KEY ("hiredUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateActivity" ADD CONSTRAINT "CandidateActivity_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleChecklistItem" ADD CONSTRAINT "LifecycleChecklistItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleTask" ADD CONSTRAINT "LifecycleTask_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleTask" ADD CONSTRAINT "LifecycleTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleTask" ADD CONSTRAINT "LifecycleTask_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "LifecycleChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resignation" ADD CONSTRAINT "Resignation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resignation" ADD CONSTRAINT "Resignation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
