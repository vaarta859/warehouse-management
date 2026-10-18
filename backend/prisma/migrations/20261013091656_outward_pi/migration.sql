/*
  Warnings:

  - You are about to drop the column `cost` on the `MinItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "piAmount" DECIMAL(14,2),
ADD COLUMN     "piDate" TIMESTAMP(3),
ADD COLUMN     "piFileKey" TEXT,
ADD COLUMN     "piFileName" TEXT,
ADD COLUMN     "piFileType" TEXT,
ADD COLUMN     "piNumber" TEXT;

-- AlterTable
ALTER TABLE "MinItem" DROP COLUMN "cost";
