-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "sourceGovernmentHolidayId" TEXT;

-- CreateTable
CREATE TABLE "GovernmentHoliday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "year" INTEGER NOT NULL,

    CONSTRAINT "GovernmentHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovernmentHoliday_year_state_idx" ON "GovernmentHoliday"("year", "state");

-- CreateIndex
CREATE UNIQUE INDEX "GovernmentHoliday_date_name_state_key" ON "GovernmentHoliday"("date", "name", "state");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_sourceGovernmentHolidayId_fkey" FOREIGN KEY ("sourceGovernmentHolidayId") REFERENCES "GovernmentHoliday"("id") ON DELETE SET NULL ON UPDATE CASCADE;
