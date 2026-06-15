import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const VENDOR_CODE = "ANKU-FTV";
  const USERNAME = "vendor";
  const PASSWORD = "vendor@123";
  const EMAIL = "vendor.demo@example.com";

  // 1. Demo vendor (ACTIVE, model FTV).
  const vendor = await prisma.vendor.upsert({
    where: { code: VENDOR_CODE },
    update: { status: "ACTIVE", model: "FTV" },
    create: {
      code: VENDOR_CODE,
      name: "Ankur Apparel",
      email: EMAIL,
      model: "FTV",
      status: "ACTIVE",
      contactName: "Ankur",
      bankName: "HDFC Bank",
      ifsc: "HDFC0001234",
      accountNo: "406008373",
      accountType: "CURRENT",
    },
  });

  // 2. Vendor-admin user linked to that vendor.
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await prisma.user.upsert({
    where: { username: USERNAME },
    update: { passwordHash, role: "VENDOR_ADMIN", vendorId: vendor.id, isActive: true, email: EMAIL },
    create: {
      username: USERNAME,
      email: EMAIL,
      passwordHash,
      role: "VENDOR_ADMIN",
      vendorId: vendor.id,
      isActive: true,
    },
  });

  console.log("✔ Vendor login ready");
  console.log(`  Vendor : ${vendor.name} (${vendor.code}, ${vendor.model})`);
  console.log(`  Login  : ${USERNAME} / ${PASSWORD}  →  lands on /portal`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
