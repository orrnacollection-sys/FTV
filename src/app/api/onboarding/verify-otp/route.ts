import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyOtp } from "@/lib/otp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const body = z.object({
  email: z.string().trim().email().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const ipLimit = rateLimit(`verify-ip:${ip}`, 20, 60_000);
  if (!ipLimit.ok) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email + 6-digit code required" }, { status: 400 });
  }

  const result = await verifyOtp(parsed.data.email, parsed.data.code);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
