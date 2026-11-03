-- AlterTable
ALTER TABLE "WarehouseAccess" ADD COLUMN     "canDeleteInward" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canDeleteOutward" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canUpdateInward" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canUpdateOutward" BOOLEAN NOT NULL DEFAULT false;
