-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "accountType" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "applicationNotes" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "appliedAt" DATETIME;
ALTER TABLE "Vendor" ADD COLUMN "branch" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "businessType" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "catalogLink" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "chequeUrl" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "designation" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "gstCertUrl" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "priceRange" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "productCategoryHint" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "productCountRange" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "referralSource" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "Vendor" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "samplesLink" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "website" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "yearsInBusiness" TEXT;

-- CreateTable
CREATE TABLE "EmailOTP" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EmailOTP_email_idx" ON "EmailOTP"("email");

-- CreateIndex
CREATE INDEX "EmailOTP_expiresAt_idx" ON "EmailOTP"("expiresAt");
