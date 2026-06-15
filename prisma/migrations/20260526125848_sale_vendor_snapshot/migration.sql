/*
  Warnings:

  - Added the required column `vendorId` to the `Sale` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vchDate" DATETIME NOT NULL,
    "marketplace" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
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
INSERT INTO "new_Sale" ("createdAt", "createdBy", "id", "itemId", "manualRemarks", "marketplace", "qtyRTO", "qtyReturn", "qtySold", "taxRate", "transactionType", "unitRate", "vchDate") SELECT "createdAt", "createdBy", "id", "itemId", "manualRemarks", "marketplace", "qtyRTO", "qtyReturn", "qtySold", "taxRate", "transactionType", "unitRate", "vchDate" FROM "Sale";
DROP TABLE "Sale";
ALTER TABLE "new_Sale" RENAME TO "Sale";
CREATE INDEX "Sale_itemId_idx" ON "Sale"("itemId");
CREATE INDEX "Sale_itemId_vchDate_idx" ON "Sale"("itemId", "vchDate");
CREATE INDEX "Sale_vchDate_idx" ON "Sale"("vchDate");
CREATE INDEX "Sale_marketplace_idx" ON "Sale"("marketplace");
CREATE INDEX "Sale_transactionType_idx" ON "Sale"("transactionType");
CREATE INDEX "Sale_vendorId_idx" ON "Sale"("vendorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
