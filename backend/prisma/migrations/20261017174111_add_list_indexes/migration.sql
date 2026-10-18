-- CreateIndex
CREATE INDEX "Grn_warehouseId_createdAt_idx" ON "Grn"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "GrnItem_category_sku_idx" ON "GrnItem"("category", "sku");

-- CreateIndex
CREATE INDEX "Min_warehouseId_createdAt_idx" ON "Min"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "Min_warehouseId_status_createdAt_idx" ON "Min"("warehouseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Min_warehouseId_customerName_idx" ON "Min"("warehouseId", "customerName");

-- CreateIndex
CREATE INDEX "MinItem_category_sku_idx" ON "MinItem"("category", "sku");
