-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "billToContactNo" TEXT,
ADD COLUMN     "billToContactPerson" TEXT,
ADD COLUMN     "billToEmail" TEXT,
ADD COLUMN     "shipToContactNo" TEXT,
ADD COLUMN     "shipToContactPerson" TEXT,
ADD COLUMN     "shipToLocation" TEXT;

-- AlterTable
ALTER TABLE "MinItem" ADD COLUMN     "approvedBy" TEXT;
