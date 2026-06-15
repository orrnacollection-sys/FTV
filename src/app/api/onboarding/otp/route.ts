import { NextResponse } from "next/server";
import { z } from "zod";
import { issueOtp } from "@/lib/otp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const body = z.object({ email: z.string().trim().email().toLowerCase() });

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const ipLimit = rateLimit(`otp-ip:${ip}`, 10, 60_000);
  if (!ipLimit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const emailLimit = rateLimit(`otp-email:${parsed.data.email}`, 3, 60_000);
  if (!emailLimit.ok) return NextResponse.json({ error: "Too many requests for this email" }, { status: 429 });

  const result = await issueOtp(parsed.data.email);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
