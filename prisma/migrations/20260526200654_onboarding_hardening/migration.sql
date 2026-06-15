-- Add @unique on Vendor.email and consumedAt on EmailOTP.

-- SQLite doesn't support adding a UNIQUE constraint inline via ALTER TABLE,
-- so we add a unique index instead (which Prisma treats equivalently).
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

ALTER TABLE "EmailOTP" ADD COLUMN "consumedAt" DATETIME;
