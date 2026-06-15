import { z } from "zod";

export const BUSINESS_TYPES = ["MANUFACTURER", "TRADER_WHOLESALER", "BOUTIQUE_DESIGNER", "IMPORTER", "OTHER"] as const;
export const BUSINESS_TYPE_LABELS: Record<(typeof BUSINESS_TYPES)[number], string> = {
  MANUFACTURER: "Manufacturer",
  TRADER_WHOLESALER: "Trader / Wholesaler",
  BOUTIQUE_DESIGNER: "Boutique / Designer",
  IMPORTER: "Importer",
  OTHER: "Other",
};

export const ACCOUNT_TYPES = ["CURRENT", "SAVINGS"] as const;
export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  CURRENT: "Current",
  SAVINGS: "Savings",
};

const optStr = z.string().trim().optional().or(z.literal("").transform(() => undefined));

export const applicationSubmissionSchema = z.object({
  // Identity (set after OTP)
  email: z.string().trim().email().toLowerCase(),

  // Business
  name: z.string().trim().min(1, "Business name required").max(200),
  businessType: z.enum(BUSINESS_TYPES, { message: "Pick a business type" }),
  yearsInBusiness: optStr,
  gst: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, "Invalid GST")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  pan: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: optStr,

  // Contact
  contactName: z.string().trim().min(1, "Contact name required").max(120),
  designation: optStr,
  whatsapp: optStr,
  website: optStr,
  referralSource: optStr,

  // Catalog
  productCategoryHint: optStr,
  productCountRange: optStr,
  priceRange: optStr,
  catalogLink: optStr,
  samplesLink: optStr,
  applicationNotes: optStr,

  // Bank
  bankName: z.string().trim().min(1, "Bank name required").max(120),
  accountNo: z.string().trim().regex(/^[A-Za-z0-9]{6,20}$/, "Account number 6–20 chars"),
  ifsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC"),
  accountType: z.enum(ACCOUNT_TYPES),
  branch: optStr,

  // Documents — URLs returned by the upload action
  gstCertUrl: optStr,
  chequeUrl: optStr,

  consent: z.literal("true", { message: "Consent required" }),
});

export type ApplicationSubmission = z.infer<typeof applicationSubmissionSchema>;
