-- CreateEnum
CREATE TYPE "OutwardStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING_DISPATCH', 'DISPATCHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CostStatus" AS ENUM ('COMPLETED', 'PARTIALLY_COMPLETED', 'PENDING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'SALES';
ALTER TYPE "Role" ADD VALUE 'ACCOUNT';

-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "approvalRemarks" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedById" TEXT,
ADD COLUMN     "dispatchedByName" TEXT,
ADD COLUMN     "status" "OutwardStatus" NOT NULL DEFAULT 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "MinItem" ADD COLUMN     "cost" DECIMAL(14,2),
ADD COLUMN     "costStatus" "CostStatus",
ADD COLUMN     "proofFileKey" TEXT,
ADD COLUMN     "proofFileName" TEXT,
ADD COLUMN     "proofFileType" TEXT,
ADD COLUMN     "utrNumber" TEXT;

-- CreateIndex
CREATE INDEX "Min_status_idx" ON "Min"("status");
