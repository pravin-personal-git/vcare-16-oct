-- AlterTable
ALTER TABLE "SalaryComponent" ADD COLUMN     "calcType" TEXT NOT NULL DEFAULT 'fixed',
ADD COLUMN     "capPaise" INTEGER,
ADD COLUMN     "ratePct" DECIMAL(5,2),
ALTER COLUMN "monthlyPaise" DROP NOT NULL;
