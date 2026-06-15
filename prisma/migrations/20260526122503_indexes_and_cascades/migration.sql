-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsn" TEXT,
    "categoryId" TEXT,
    "vendorId" TEXT NOT NULL,
    "vendorSku" TEXT,
    "model" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("categoryId", "createdAt", "hsn", "id", "imageUrl", "model", "name", "skuCode", "updatedAt", "vendorId", "vendorSku") SELECT "categoryId", "createdAt", "hsn", "id", "imageUrl", "model", "name", "skuCode", "updatedAt", "vendorId", "vendorSku" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_skuCode_key" ON "Item"("skuCode");
CREATE INDEX "Item_name_idx" ON "Item"("name");
CREATE INDEX "Item_vendorId_idx" ON "Item"("vendorId");
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "vendorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "id", "isActive", "lastLoginAt", "passwordHash", "role", "updatedAt", "username", "vendorId") SELECT "createdAt", "email", "id", "isActive", "lastLoginAt", "passwordHash", "role", "updatedAt", "username", "vendorId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_vendorId_idx" ON "User"("vendorId");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE TABLE "new_VendorInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "vendorId" TEXT,
    "invitedById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorInvite_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_VendorInvite" ("acceptedAt", "createdAt", "email", "expiresAt", "id", "invitedById", "role", "token", "vendorId") SELECT "acceptedAt", "createdAt", "email", "expiresAt", "id", "invitedById", "role", "token", "vendorId" FROM "VendorInvite";
DROP TABLE "VendorInvite";
ALTER TABLE "new_VendorInvite" RENAME TO "VendorInvite";
CREATE UNIQUE INDEX "VendorInvite_token_key" ON "VendorInvite"("token");
CREATE INDEX "VendorInvite_email_idx" ON "VendorInvite"("email");
CREATE INDEX "VendorInvite_vendorId_idx" ON "VendorInvite"("vendorId");
CREATE INDEX "VendorInvite_email_acceptedAt_idx" ON "VendorInvite"("email", "acceptedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
