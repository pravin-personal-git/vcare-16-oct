-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowLinkedAccounts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowSelfServiceBusinessCreation" BOOLEAN NOT NULL DEFAULT true;
