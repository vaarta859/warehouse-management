/*
  Warnings:

  - You are about to drop the column `referenceDocuments` on the `StockTransferSerial` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "referenceDocuments" JSONB;

-- AlterTable
ALTER TABLE "StockTransferSerial" DROP COLUMN "referenceDocuments";
