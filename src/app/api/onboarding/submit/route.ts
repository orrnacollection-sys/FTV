import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applicationSubmissionSchema } from "@/lib/validators/application";
import { isEmailVerified, consumeVerifiedOtp } from "@/lib/otp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logWrite } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const ipLimit = rateLimit(`onboard-submit-ip:${ip}`, 5, 60_000);
  if (!ipLimit.ok) return NextResponse.json({ error: "Too many submissions" }, { status: 429 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = applicationSubmissionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        fieldErrors: Object.fromEntries(
          Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
        ),
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const verified = await isEmailVerified(data.email);
  if (!verified) return NextResponse.json({ error: "Email not verified" }, { status: 403 });

  // PENDING application — code + model are null; admin assigns both at approval.
  // Email is @unique so duplicate submissions are serialized by the DB. We mirror
  // the success shape on email-collision to avoid account enumeration.
  let referenceId = "";
  try {
    const v = await prisma.vendor.create({
      data: {
        code: null,
        model: null,
        name: data.name,
        email: data.email,
        whatsapp: data.whatsapp ?? null,
        gst: data.gst ?? null,
        pan: data.pan ?? null,
        ifsc: data.ifsc,
        bankName: data.bankName,
        accountNo: data.accountNo,
        address: data.address ?? null,
        status: "PENDING",
        contactName: data.contactName,
        designation: data.designation ?? null,
        website: data.website ?? null,
        businessType: data.businessType,
        yearsInBusiness: data.yearsInBusiness ?? null,
        referralSource: data.referralSource ?? null,
        productCategoryHint: data.productCategoryHint ?? null,
        productCountRange: data.productCountRange ?? null,
        priceRange: data.priceRange ?? null,
        catalogLink: data.catalogLink ?? null,
        samplesLink: data.samplesLink ?? null,
        applicationNotes: data.applicationNotes ?? null,
        accountType: data.accountType,
        branch: data.branch ?? null,
        gstCertUrl: data.gstCertUrl ?? null,
        chequeUrl: data.chequeUrl ?? null,
        appliedAt: new Date(),
      },
    });
    referenceId = v.id;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      // Email already on file — burn the verification + ack generically.
      await consumeVerifiedOtp(data.email);
      return NextResponse.json({
        ok: true,
        message: "Application received. We'll review and email you within 2 business days.",
      });
    }
    throw e;
  }

  await consumeVerifiedOtp(data.email);
  await logWrite("Vendor", referenceId, "CREATE", null, {
    via: "onboarding",
    // Code + email intentionally omitted — admin assigns code at approval; email is PII.
  });

  return NextResponse.json({
    ok: true,
    message: "Application received. We'll review and email you within 2 business days.",
  });
}
