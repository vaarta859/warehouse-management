-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromCompanyId" TEXT NOT NULL,
    "fromCompanyName" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "fromWarehouseName" TEXT NOT NULL,
    "toCompanyId" TEXT NOT NULL,
    "toCompanyName" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "toWarehouseName" TEXT NOT NULL,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockType" TEXT NOT NULL,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferSerial" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "StockTransferSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "StockTransfer_fromWarehouseId_idx" ON "StockTransfer"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_toWarehouseId_idx" ON "StockTransfer"("toWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_fromCompanyId_idx" ON "StockTransfer"("fromCompanyId");

-- CreateIndex
CREATE INDEX "StockTransfer_toCompanyId_idx" ON "StockTransfer"("toCompanyId");

-- CreateIndex
CREATE INDEX "StockTransfer_createdAt_idx" ON "StockTransfer"("createdAt");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_category_sku_idx" ON "StockTransferItem"("category", "sku");

-- CreateIndex
CREATE INDEX "StockTransferSerial_transferId_idx" ON "StockTransferSerial"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferSerial_serialNo_idx" ON "StockTransferSerial"("serialNo");

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferSerial" ADD CONSTRAINT "StockTransferSerial_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
