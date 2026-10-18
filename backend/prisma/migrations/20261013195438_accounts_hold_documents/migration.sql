-- AlterEnum
ALTER TYPE "OutwardStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "MinReferenceDocument" ADD COLUMN     "vehicleNumber" TEXT;
