"use server";
import { headers } from "next/headers";
import { signIn } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function signInAction(formData: FormData) {
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rl = rateLimit(`login-ip:${ip}`, 12, 60_000);
  if (!rl.ok) return { error: "Too many attempts — please wait a minute" };

  try {
    await signIn("credentials", {
      username: String(formData.get("username") ?? "").toLowerCase().trim(),
      password: String(formData.get("password") ?? ""),
      redirect: false,
    });
    return { ok: true };
  } catch {
    return { error: "Invalid username or password" };
  }
}
