-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "Min" DROP CONSTRAINT "Min_warehouseId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "warehouseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Min" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "directDispatch" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "warehouseId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Min_companyId_directDispatch_status_idx" ON "Min"("companyId", "directDispatch", "status");

-- AddForeignKey
ALTER TABLE "Min" ADD CONSTRAINT "Min_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Min" ADD CONSTRAINT "Min_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
