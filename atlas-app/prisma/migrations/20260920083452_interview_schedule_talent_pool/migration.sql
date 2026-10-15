-- CreateTable
CREATE TABLE "InterviewSchedule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewInterviewer" (
    "interviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "InterviewInterviewer_pkey" PRIMARY KEY ("interviewId","userId")
);

-- CreateTable
CREATE TABLE "SkillZone" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillZoneCandidate" (
    "id" TEXT NOT NULL,
    "skillZoneId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillZoneCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewSchedule_storeId_candidateId_idx" ON "InterviewSchedule"("storeId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillZone_storeId_title_key" ON "SkillZone"("storeId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "SkillZoneCandidate_skillZoneId_candidateId_key" ON "SkillZoneCandidate"("skillZoneId", "candidateId");

-- AddForeignKey
ALTER TABLE "InterviewSchedule" ADD CONSTRAINT "InterviewSchedule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSchedule" ADD CONSTRAINT "InterviewSchedule_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewInterviewer" ADD CONSTRAINT "InterviewInterviewer_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "InterviewSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewInterviewer" ADD CONSTRAINT "InterviewInterviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillZone" ADD CONSTRAINT "SkillZone_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillZoneCandidate" ADD CONSTRAINT "SkillZoneCandidate_skillZoneId_fkey" FOREIGN KEY ("skillZoneId") REFERENCES "SkillZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillZoneCandidate" ADD CONSTRAINT "SkillZoneCandidate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
