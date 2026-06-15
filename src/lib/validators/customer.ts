import { z } from "zod";
import {
  CUSTOMER_STATUSES,
  PRICE_TIERS,
  INDIAN_STATES,
  PINCODE_REGEX,
  COUNTRIES,
  GST_REG_TYPES,
} from "@/lib/constants";

const opt = (s: z.ZodString) =>
  s.optional().or(z.literal("").transform(() => undefined));

/** Admin-create / admin-edit form. Mirrors Vendor's address + GST shape
 *  so the multi-GSTIN suggestion chip is reusable. Adds receivables fields:
 *  credit limit, payment terms, price tier, sales rep. */
export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),

  /// Customer code is optional but uppercased + restricted format if set.
  code: opt(
    z
      .string()
      .trim()
      .toUpperCase()
      .max(20, "Max 20 characters")
      .regex(/^[A-Z0-9-]+$/, "Letters, digits and - only"),
  ),

  email: opt(z.string().trim().email("Invalid email")),
  mobile: opt(z.string().trim().max(20)),
  whatsapp: opt(z.string().trim().max(20)),

  gst: opt(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/,
        "Invalid GST",
      ),
  ),
  gstRegType: z.enum(GST_REG_TYPES).default("UNREGISTERED"),
  pan: opt(
    z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN"),
  ),

  bankName: opt(z.string().trim().max(100)),
  accountNo: opt(
    z.string().trim().regex(/^[A-Za-z0-9]{6,20}$/, "Account number 6–20 chars"),
  ),
  ifsc: opt(
    z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC"),
  ),

  address: opt(z.string().trim().max(500)),
  city: opt(z.string().trim().max(100)),
  state: z.enum(INDIAN_STATES).optional().or(z.literal("").transform(() => undefined)),
  pincode: opt(z.string().trim().regex(PINCODE_REGEX, "6-digit pincode, first digit 1-9")),
  country: z.enum(COUNTRIES).optional().or(z.literal("").transform(() => undefined)),

  priceTier: z.enum(PRICE_TIERS).default("RETAIL"),

  /// Credit limit — empty string OR a positive number.
  creditLimit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
    }),

  /// Payment terms in days. Empty or invalid → 0 (cash-on-delivery).
  paymentTermsDays: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    }),

  salesRep: opt(z.string().trim().max(100)),

  status: z.enum(CUSTOMER_STATUSES).default("ACTIVE"),
});

export type CustomerInput = z.infer<typeof customerSchema>;
