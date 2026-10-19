-- CreateTable
CREATE TABLE "WarehouseCompanyLink" (
    "warehouseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseCompanyLink_pkey" PRIMARY KEY ("warehouseId","companyId")
);

-- CreateIndex
CREATE INDEX "WarehouseCompanyLink_companyId_idx" ON "WarehouseCompanyLink"("companyId");

-- AddForeignKey
ALTER TABLE "WarehouseCompanyLink" ADD CONSTRAINT "WarehouseCompanyLink_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCompanyLink" ADD CONSTRAINT "WarehouseCompanyLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
