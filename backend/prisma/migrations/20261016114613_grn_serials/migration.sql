-- CreateTable
CREATE TABLE "GrnSerial" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrnSerial_serialNo_idx" ON "GrnSerial"("serialNo");

-- CreateIndex
CREATE INDEX "GrnSerial_grnId_category_sku_idx" ON "GrnSerial"("grnId", "category", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "GrnSerial_grnId_serialNo_key" ON "GrnSerial"("grnId", "serialNo");

-- AddForeignKey
ALTER TABLE "GrnSerial" ADD CONSTRAINT "GrnSerial_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
