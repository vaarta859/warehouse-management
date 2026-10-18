-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "driverContact" TEXT,
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "receivedByName" TEXT,
ADD COLUMN     "receivedDate" TIMESTAMP(3),
ADD COLUMN     "receiverContact" TEXT,
ADD COLUMN     "receiverName" TEXT,
ADD COLUMN     "receivingRemarks" TEXT;
