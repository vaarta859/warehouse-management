-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutwardStatus" ADD VALUE 'TRANSPORT_PENDING';
ALTER TYPE "OutwardStatus" ADD VALUE 'DOCS_PENDING';
ALTER TYPE "OutwardStatus" ADD VALUE 'READY_FOR_DISPATCH';
ALTER TYPE "OutwardStatus" ADD VALUE 'DELIVERED';
