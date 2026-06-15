import { z } from "zod";
import { TAX_SUPPLY_TYPES } from "@/lib/constants";

const opt = (s: z.ZodString) =>
  s.optional().or(z.literal("").transform(() => undefined));

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal(""), z.boolean()])
  .transform((v) => v === true || v === "on" || v === "true")
  .default(false);

/** Admin form for adding/editing one HSN→Rate row. */
export const hsnRateSchema = z.object({
  hsn: z
    .string()
    .trim()
    .regex(/^[0-9]{4,8}$/, "HSN/SAC must be 4–8 digits"),
  description: z.string().trim().min(1, "Description is required").max(300),
  slabRate: z
    .union([z.string(), z.number()])
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : NaN;
    })
    .pipe(z.number().min(0, "Rate ≥ 0").max(100, "Rate ≤ 100")),
  cessRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }),
  supplyType: z.enum(TAX_SUPPLY_TYPES).default("REGULAR"),
  isReverseCharge: checkbox,
  effectiveFrom: z
    .string()
    .trim()
    .min(1, "Effective date required")
    .transform((s) => {
      const d = new Date(s);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return d;
    }),
  notes: opt(z.string().trim().max(500)),
  isActive: checkbox,
});

export type HsnRateInput = z.infer<typeof hsnRateSchema>;

/** Admin form for editing a single TaxComponent (enable/disable + name).
 *  The `code`, `family`, `chargeType`, `scope`, `slabFraction` are immutable
 *  (Indian law defines them). */
export const taxComponentEditSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  isActive: checkbox,
  sortOrder: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }),
});

export type TaxComponentEditInput = z.infer<typeof taxComponentEditSchema>;
