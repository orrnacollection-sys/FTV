import { z } from "zod";
import { COUNTRIES, INDIAN_STATES, PINCODE_REGEX } from "@/lib/constants";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const opt = (s: z.ZodString) =>
  s.optional().or(z.literal("").transform(() => undefined));

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal(""), z.boolean()])
  .transform((v) => v === true || v === "on" || v === "true")
  .default(false);

/** Edit-company form. The single Adwitiya row is created via seed; admin
 *  edits via /settings/company-profile. SaaS later: new tenants create
 *  their first Company row through the signup wizard, not this form. */
export const companySchema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required").max(200),
  brandName: z.string().trim().min(1, "Brand name is required").max(120),
  pan: opt(z.string().trim().toUpperCase().regex(PAN_REGEX, "Invalid PAN")),
  tan: opt(z.string().trim().toUpperCase().regex(TAN_REGEX, "Invalid TAN")),
  cin: opt(z.string().trim().toUpperCase().max(21)),
  address: opt(z.string().trim().max(500)),
  city: opt(z.string().trim().max(100)),
  state: z.enum(INDIAN_STATES).optional().or(z.literal("").transform(() => undefined)),
  pincode: opt(z.string().trim().regex(PINCODE_REGEX, "6-digit pincode, first digit 1-9")),
  country: z.enum(COUNTRIES).optional().or(z.literal("").transform(() => undefined)),
  email: opt(z.string().trim().email("Invalid email")),
  mobile: opt(z.string().trim().max(20)),
  website: opt(z.string().trim().max(200)),
  logoUrl: opt(z.string().trim().max(500)),
  baseCurrency: z.string().trim().toUpperCase().length(3).default("INR"),
  fyStartMonth: z
    .union([z.string(), z.number()])
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 4;
    })
    .pipe(z.number().int().min(1).max(12))
    .default(4),
  bankName: opt(z.string().trim().max(100)),
  accountNo: opt(z.string().trim().regex(/^[A-Za-z0-9]{6,20}$/, "Account number 6–20 chars")),
  ifsc: opt(z.string().trim().toUpperCase().regex(IFSC_REGEX, "Invalid IFSC")),
});

export type CompanyInput = z.infer<typeof companySchema>;

export const REGISTRATION_TYPES = ["REGULAR", "COMPOSITION", "CASUAL", "SEZ"] as const;
export const PLACE_TYPES = ["PPOB", "APOB"] as const;

/** Add/edit one GSTIN registration. Address fields have moved out — they
 *  live on CompanyGSTINPlace rows now. */
export const companyGstinSchema = z.object({
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, "Invalid GSTIN"),
  state: z.enum(INDIAN_STATES),
  registrationType: z.enum(REGISTRATION_TYPES).default("REGULAR"),
  isActive: checkbox,
  isDefault: checkbox,
});

export type CompanyGstinInput = z.infer<typeof companyGstinSchema>;

/** Add/edit one place (PPOB or APOB) under a GSTIN. */
export const companyPlaceSchema = z.object({
  nickname: z.string().trim().min(1, "Nickname is required").max(120),
  placeType: z.enum(PLACE_TYPES).default("APOB"),
  address: opt(z.string().trim().max(500)),
  city: opt(z.string().trim().max(100)),
  pincode: opt(z.string().trim().regex(PINCODE_REGEX, "6-digit pincode, first digit 1-9")),
  isActive: checkbox,
  /** Optional link to a Warehouse row that operates this place. */
  warehouseId: opt(z.string().trim().max(64)),
});

export type CompanyPlaceInput = z.infer<typeof companyPlaceSchema>;
