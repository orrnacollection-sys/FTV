-- Move `model` from Item → Vendor. Make Vendor.code nullable (PENDING apps have no code yet).

PRAGMA foreign_keys=OFF;

-- 1. Add Vendor.model (nullable). Backfill from any pre-existing Item.model
--    by taking the first item's model per vendor.
ALTER TABLE "Vendor" ADD COLUMN "model" TEXT;

UPDATE "Vendor"
SET "model" = (
  SELECT "model"
  FROM "Item"
  WHERE "Item"."vendorId" = "Vendor"."id"
  ORDER BY "Item"."createdAt" ASC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "Item" WHERE "Item"."vendorId" = "Vendor"."id");

-- 2. Make Vendor.code nullable. SQLite needs a full table rebuild for this.
CREATE TABLE "new_Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "whatsapp" TEXT,
    "gst" TEXT,
    "pan" TEXT,
    "ifsc" TEXT,
    "bankName" TEXT,
    "accountNo" TEXT,
    "address" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contactName" TEXT,
    "designation" TEXT,
    "website" TEXT,
    "businessType" TEXT,
    "yearsInBusiness" TEXT,
    "referralSource" TEXT,
    "productCategoryHint" TEXT,
    "productCountRange" TEXT,
    "priceRange" TEXT,
    "catalogLink" TEXT,
    "samplesLink" TEXT,
    "applicationNotes" TEXT,
    "accountType" TEXT,
    "branch" TEXT,
    "gstCertUrl" TEXT,
    "chequeUrl" TEXT,
    "appliedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Vendor" SELECT
    "id", "code", "name", "email", "whatsapp", "gst", "pan", "ifsc", "bankName", "accountNo", "address",
    "model", "status",
    "contactName", "designation", "website", "businessType", "yearsInBusiness", "referralSource",
    "productCategoryHint", "productCountRange", "priceRange", "catalogLink", "samplesLink",
    "applicationNotes", "accountType", "branch", "gstCertUrl", "chequeUrl",
    "appliedAt", "reviewedAt", "reviewedById", "reviewNotes", "createdAt", "updatedAt"
FROM "Vendor";
DROP TABLE "Vendor";
ALTER TABLE "new_Vendor" RENAME TO "Vendor";
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- 3. Drop Item.model. Rebuild Item table without it.
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsn" TEXT,
    "categoryId" TEXT,
    "vendorId" TEXT NOT NULL,
    "vendorSku" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Item" SELECT
    "id", "skuCode", "name", "hsn", "categoryId", "vendorId", "vendorSku", "imageUrl", "createdAt", "updatedAt"
FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_skuCode_key" ON "Item"("skuCode");
CREATE INDEX "Item_name_idx" ON "Item"("name");
CREATE INDEX "Item_vendorId_idx" ON "Item"("vendorId");
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

PRAGMA foreign_keys=ON;
