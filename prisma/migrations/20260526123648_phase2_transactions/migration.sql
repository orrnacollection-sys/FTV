-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "poDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "total" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "taxRate" REAL NOT NULL,
    "total" REAL NOT NULL,
    "receivedQty" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GRN" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grnNo" TEXT NOT NULL,
    "grnDate" DATETIME NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PURCHASE',
    "vendorId" TEXT NOT NULL,
    "vendorInvoiceNo" TEXT,
    "vendorInvoiceDate" DATETIME,
    "total" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    CONSTRAINT "GRN_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GRNItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "poItemId" TEXT,
    "poId" TEXT,
    "qty" REAL NOT NULL,
    "rejectedQty" REAL NOT NULL DEFAULT 0,
    "rate" REAL NOT NULL,
    "taxRate" REAL NOT NULL,
    "taxableValue" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "totalValue" REAL NOT NULL,
    "batchNo" TEXT NOT NULL,
    "batchExpDate" DATETIME NOT NULL,
    CONSTRAINT "GRNItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GRNItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GRNItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GRNItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vchDate" DATETIME NOT NULL,
    "marketplace" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "qtySold" REAL NOT NULL DEFAULT 0,
    "qtyReturn" REAL NOT NULL DEFAULT 0,
    "qtyRTO" REAL NOT NULL DEFAULT 0,
    "unitRate" REAL NOT NULL,
    "taxRate" REAL NOT NULL,
    "manualRemarks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "Sale_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WarehouseTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "WarehouseTransfer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_poDate_idx" ON "PurchaseOrder"("poDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_poId_idx" ON "PurchaseOrderItem"("poId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_itemId_idx" ON "PurchaseOrderItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "GRN_grnNo_key" ON "GRN"("grnNo");

-- CreateIndex
CREATE INDEX "GRN_vendorId_idx" ON "GRN"("vendorId");

-- CreateIndex
CREATE INDEX "GRN_grnDate_idx" ON "GRN"("grnDate");

-- CreateIndex
CREATE INDEX "GRN_type_idx" ON "GRN"("type");

-- CreateIndex
CREATE INDEX "GRNItem_grnId_idx" ON "GRNItem"("grnId");

-- CreateIndex
CREATE INDEX "GRNItem_itemId_idx" ON "GRNItem"("itemId");

-- CreateIndex
CREATE INDEX "GRNItem_poItemId_idx" ON "GRNItem"("poItemId");

-- CreateIndex
CREATE INDEX "GRNItem_poId_idx" ON "GRNItem"("poId");

-- CreateIndex
CREATE INDEX "Sale_itemId_idx" ON "Sale"("itemId");

-- CreateIndex
CREATE INDEX "Sale_vchDate_idx" ON "Sale"("vchDate");

-- CreateIndex
CREATE INDEX "Sale_marketplace_idx" ON "Sale"("marketplace");

-- CreateIndex
CREATE INDEX "Sale_transactionType_idx" ON "Sale"("transactionType");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_itemId_idx" ON "WarehouseTransfer"("itemId");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_date_idx" ON "WarehouseTransfer"("date");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_type_idx" ON "WarehouseTransfer"("type");
