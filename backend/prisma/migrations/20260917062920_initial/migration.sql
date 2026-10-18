-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'WAREHOUSE_MANAGER');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('NONE', 'MANAGE');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "locality" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "locality" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "Inward" TEXT NOT NULL DEFAULT 'Active',
    "Outward" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'NONE',
    "canInward" BOOLEAN NOT NULL DEFAULT false,
    "canOutward" BOOLEAN NOT NULL DEFAULT false,
    "canManageDocuments" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "inwardType" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "companyName" TEXT,
    "refDocType" TEXT NOT NULL,
    "refDocNumber" TEXT NOT NULL,
    "refDocDate" TIMESTAMP(3) NOT NULL,
    "ewayBillNumber" TEXT,
    "remarks" TEXT,
    "warehouseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "companyName" TEXT,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "uom" TEXT NOT NULL,

    CONSTRAINT "GrnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnReferenceDocument" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "refDocType" TEXT NOT NULL,
    "refDocNumber" TEXT,
    "ewayBillNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnReferenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Min" (
    "id" TEXT NOT NULL,
    "outwardNumber" TEXT NOT NULL,
    "outwardType" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "companyName" TEXT,
    "refDocType" TEXT NOT NULL,
    "refDocNumber" TEXT NOT NULL,
    "refDocDate" TIMESTAMP(3) NOT NULL,
    "ewayBillNumber" TEXT,
    "dispatchMode" TEXT,
    "vehicleNumber" TEXT,
    "remarks" TEXT,
    "warehouseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Min_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinItem" (
    "id" TEXT NOT NULL,
    "minId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "companyName" TEXT,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "uom" TEXT NOT NULL,

    CONSTRAINT "MinItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinReferenceDocument" (
    "id" TEXT NOT NULL,
    "minId" TEXT NOT NULL,
    "refDocType" TEXT NOT NULL,
    "refDocNumber" TEXT,
    "ewayBillNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinReferenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseCompany" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseModel" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "companyName" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "linkedType" TEXT NOT NULL,
    "linkedId" TEXT NOT NULL,
    "docCategory" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityNumber" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_companyId_idx" ON "Warehouse"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WarehouseAccess_warehouseId_idx" ON "WarehouseAccess"("warehouseId");

-- CreateIndex
CREATE INDEX "WarehouseAccess_userId_idx" ON "WarehouseAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAccess_userId_warehouseId_key" ON "WarehouseAccess"("userId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_grnNumber_key" ON "Grn"("grnNumber");

-- CreateIndex
CREATE INDEX "Grn_warehouseId_idx" ON "Grn"("warehouseId");

-- CreateIndex
CREATE INDEX "Grn_createdById_idx" ON "Grn"("createdById");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "GrnItem_category_companyName_idx" ON "GrnItem"("category", "companyName");

-- CreateIndex
CREATE INDEX "GrnReferenceDocument_grnId_idx" ON "GrnReferenceDocument"("grnId");

-- CreateIndex
CREATE UNIQUE INDEX "Min_outwardNumber_key" ON "Min"("outwardNumber");

-- CreateIndex
CREATE INDEX "Min_warehouseId_idx" ON "Min"("warehouseId");

-- CreateIndex
CREATE INDEX "Min_createdById_idx" ON "Min"("createdById");

-- CreateIndex
CREATE INDEX "MinItem_minId_idx" ON "MinItem"("minId");

-- CreateIndex
CREATE INDEX "MinItem_category_companyName_idx" ON "MinItem"("category", "companyName");

-- CreateIndex
CREATE INDEX "MinReferenceDocument_minId_idx" ON "MinReferenceDocument"("minId");

-- CreateIndex
CREATE INDEX "WarehouseCompany_warehouseId_idx" ON "WarehouseCompany"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseCompany_warehouseId_name_key" ON "WarehouseCompany"("warehouseId", "name");

-- CreateIndex
CREATE INDEX "WarehouseModel_warehouseId_idx" ON "WarehouseModel"("warehouseId");

-- CreateIndex
CREATE INDEX "WarehouseModel_warehouseId_category_companyName_idx" ON "WarehouseModel"("warehouseId", "category", "companyName");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseModel_warehouseId_category_companyName_name_key" ON "WarehouseModel"("warehouseId", "category", "companyName", "name");

-- CreateIndex
CREATE INDEX "Document_linkedType_linkedId_idx" ON "Document"("linkedType", "linkedId");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- CreateIndex
CREATE INDEX "Document_docCategory_idx" ON "Document"("docCategory");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_entityNumber_idx" ON "AuditLog"("entityNumber");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_warehouseId_idx" ON "AuditLog"("warehouseId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseAccess" ADD CONSTRAINT "WarehouseAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseAccess" ADD CONSTRAINT "WarehouseAccess_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnReferenceDocument" ADD CONSTRAINT "GrnReferenceDocument_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Min" ADD CONSTRAINT "Min_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Min" ADD CONSTRAINT "Min_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinItem" ADD CONSTRAINT "MinItem_minId_fkey" FOREIGN KEY ("minId") REFERENCES "Min"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinReferenceDocument" ADD CONSTRAINT "MinReferenceDocument_minId_fkey" FOREIGN KEY ("minId") REFERENCES "Min"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCompany" ADD CONSTRAINT "WarehouseCompany_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseModel" ADD CONSTRAINT "WarehouseModel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
