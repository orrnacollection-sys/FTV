import { z } from "zod";
import { ROLES } from "@/lib/constants";

export const inviteSchema = z
  .object({
    email: z.string().trim().email("Valid email required").toLowerCase(),
    role: z.enum(ROLES),
    vendorId: z.string().optional().or(z.literal("").transform(() => undefined)),
  })
  .refine(
    (d) => (d.role === "ADMIN" ? !d.vendorId : !!d.vendorId),
    {
      message: "Vendor required for VENDOR_ADMIN / VENDOR_USER; omit for ADMIN",
      path: ["vendorId"],
    },
  );

export type InviteInput = z.infer<typeof inviteSchema>;

export const passwordPolicy = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/[A-Z]/, "Must include an uppercase letter")
  .regex(/[a-z]/, "Must include a lowercase letter")
  .regex(/[0-9]/, "Must include a digit");

export const acceptInviteSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Username 3–40 chars")
      .max(40)
      .regex(/^[a-z0-9_.-]+$/, "Letters, digits, _ . - only"),
    password: passwordPolicy,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
