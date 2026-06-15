import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Soft anti-resend: refuse to issue a new OTP for an email more often than this.
const RESEND_INTERVAL_MS = 30 * 1000;
// Verified-OTP usefulness window (used by isEmailVerified).
const VERIFIED_WINDOW_MS = 30 * 60 * 1000;

function generateCode(): string {
  // Cryptographically uniform 0-999999, then zero-padded.
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, "0");
}

/** Lazy GC: ~1% chance per call, drop expired-and-unverified or consumed rows older than a day. */
async function maybePrune() {
  if (Math.random() > 0.01) return;
  try {
    await prisma.emailOTP.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          { consumedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
    });
  } catch (e) {
    console.error("[otp] prune failed:", e);
  }
}

export async function issueOtp(rawEmail: string): Promise<{ ok: true } | { error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { error: "Email required" };
  await maybePrune();

  // Throttle resends.
  const existing = await prisma.emailOTP.findFirst({
    where: { email, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { lastSentAt: "desc" },
  });
  if (existing && Date.now() - existing.lastSentAt.getTime() < RESEND_INTERVAL_MS) {
    const waitS = Math.ceil((RESEND_INTERVAL_MS - (Date.now() - existing.lastSentAt.getTime())) / 1000);
    return { error: `Please wait ${waitS}s before requesting another code` };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.emailOTP.create({
    data: { email, codeHash, expiresAt },
  });

  // Surface send failures when a real transport (Resend) is configured. In dev
  // with the console stub, sendEmail always succeeds.
  const transportConfigured = !!process.env.RESEND_API_KEY;
  try {
    await sendEmail({
      to: email,
      subject: "Your Adwitiya vendor application verification code",
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Don't share it with anyone.`,
    });
  } catch (e) {
    console.error("[otp] sendEmail failed:", e);
    if (transportConfigured) {
      return { error: "Could not send code right now. Please try again in a minute." };
    }
  }

  return { ok: true };
}

export async function verifyOtp(
  rawEmail: string,
  rawCode: string,
): Promise<{ ok: true } | { error: string }> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) return { error: "Invalid code format" };

  const otp = await prisma.emailOTP.findFirst({
    where: { email, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { error: "No active code — request a new one" };

  if (otp.attempts >= MAX_ATTEMPTS) {
    return { error: "Too many attempts — request a new code" };
  }

  const match = await bcrypt.compare(code, otp.codeHash);
  if (!match) {
    await prisma.emailOTP.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return { error: "Incorrect code" };
  }

  await prisma.emailOTP.update({ where: { id: otp.id }, data: { verified: true } });
  return { ok: true };
}

/**
 * True iff the email has a verified OTP issued in the last 30 minutes
 * AND it hasn't been consumed by a completed submission.
 */
export async function isEmailVerified(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const recent = await prisma.emailOTP.findFirst({
    where: {
      email,
      verified: true,
      consumedAt: null,
      createdAt: { gt: new Date(Date.now() - VERIFIED_WINDOW_MS) },
    },
  });
  return !!recent;
}

/** Mark verified-but-unconsumed OTPs for this email as consumed. */
export async function consumeVerifiedOtp(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await prisma.emailOTP.updateMany({
    where: { email, verified: true, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}
