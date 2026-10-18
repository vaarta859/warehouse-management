-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "transportMode" TEXT,
ADD COLUMN     "transportSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "transportSubmittedById" TEXT,
ADD COLUMN     "transportSubmittedByName" TEXT,
ADD COLUMN     "transporterId" TEXT,
ADD COLUMN     "transporterName" TEXT;
