import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/uploads";
import { isEmailVerified } from "@/lib/otp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["gstCert", "cheque"]);

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const ipLimit = rateLimit(`onboard-upload-ip:${ip}`, 12, 60_000);
  if (!ipLimit.ok) return NextResponse.json({ error: "Too many uploads" }, { status: 429 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!(file instanceof File)) return NextResponse.json({ error: "File required" }, { status: 400 });
  if (!ALLOWED_KINDS.has(kind)) return NextResponse.json({ error: "Invalid upload kind" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Only allow uploads from a verified email — anti-abuse.
  const verified = await isEmailVerified(email);
  if (!verified) return NextResponse.json({ error: "Verify your email first" }, { status: 403 });

  try {
    const url = await saveUpload(`onboarding-${kind}`, file, { maxBytes: 5 * 1024 * 1024 });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 },
    );
  }
}
