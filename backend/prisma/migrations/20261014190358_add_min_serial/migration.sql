-- CreateTable
CREATE TABLE "MinSerial" (
    "id" TEXT NOT NULL,
    "minId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MinSerial_serialNo_idx" ON "MinSerial"("serialNo");

-- CreateIndex
CREATE INDEX "MinSerial_minId_category_sku_idx" ON "MinSerial"("minId", "category", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "MinSerial_minId_serialNo_key" ON "MinSerial"("minId", "serialNo");

-- AddForeignKey
ALTER TABLE "MinSerial" ADD CONSTRAINT "MinSerial_minId_fkey" FOREIGN KEY ("minId") REFERENCES "Min"("id") ON DELETE CASCADE ON UPDATE CASCADE;
