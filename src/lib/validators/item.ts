import { z } from "zod";

const optionalStr = z
  .string()
  .trim()
  .optional()
  .or(z.literal("").transform(() => undefined));

const numericString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => !Number.isNaN(Number(v)), `${label} must be a number`)
    .transform((v) => Number(v));

export const itemSchema = z.object({
  skuCode: z.string().trim().min(1, "SKU code required").max(60),
  name: z.string().trim().min(1, "Name required").max(200),
  itemType: z.enum(["GOODS", "SERVICE"]).default("GOODS"),
  hsn: optionalStr,
  categoryId: optionalStr,
  vendorId: z.string().trim().min(1, "Vendor required"),
  vendorSku: optionalStr,
  imageUrl: optionalStr,
  model: z.string().trim().toUpperCase().min(1, "Pick a model").max(30),
  transferPrice: numericString("Transfer price").pipe(z.number().nonnegative()),
  taxRate: numericString("Tax rate").pipe(z.number().min(0).max(100)),
  effectiveDate: z.string().trim().min(1, "Effective date required"),
});

export type ItemInput = z.infer<typeof itemSchema>;

// Standalone price/terms-update: appends a new ItemPriceRevision (history kept).
export const priceRevisionSchema = z.object({
  model: z.string().trim().toUpperCase().min(1, "Pick a model").max(30),
  transferPrice: numericString("Transfer price").pipe(z.number().nonnegative()),
  taxRate: numericString("Tax rate").pipe(z.number().min(0).max(100)),
  effectiveDate: z.string().trim().min(1, "Effective date required"),
});

export type PriceRevisionInput = z.infer<typeof priceRevisionSchema>;
