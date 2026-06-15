import { z } from "zod";
import { VENDOR_STATUSES, INDIAN_STATES, PINCODE_REGEX, COUNTRIES, GST_REG_TYPES } from "@/lib/constants";

// Admin-create / admin-edit form. The vendor `code` is now entered manually
// (no auto-generation). A vendor no longer carries a model (model lives on the
// item, effective-dated).
export const vendorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  // Vendor code is optional, but if provided it must be 1-20 chars of letters,
  // digits or "-". DB enforces uniqueness.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(20, "Max 20 characters")
    .regex(/^[A-Z0-9-]+$/, "Letters, digits and - only")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  whatsapp: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  gst: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, "Invalid GST")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  gstRegType: z.enum(GST_REG_TYPES).default("UNREGISTERED"),
  pan: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  ifsc: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  bankName: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  accountNo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6,20}$/, "Account number 6–20 chars")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  // Structured address fields. All optional — legacy rows keep the free-text
  // `address` blob. Form encourages filling for new vendors.
  city: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  state: z.enum(INDIAN_STATES).optional().or(z.literal("").transform(() => undefined)),
  pincode: z
    .string()
    .trim()
    .regex(PINCODE_REGEX, "6-digit pincode, first digit 1-9")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  country: z.enum(COUNTRIES).optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(VENDOR_STATUSES).default("ACTIVE"),
  // Stale-stock tolerance window in days. Null/empty = use the system default
  // (120). Captured per agreement.
  staleDays: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
    }),
});

export type VendorInput = z.infer<typeof vendorSchema>;
