import { z } from "zod";

const numericString = (label: string, max?: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => !Number.isNaN(Number(v)), `${label} must be a number`)
    .transform((v) => Number(v))
    .pipe(max != null ? z.number().min(0).max(max) : z.number().nonnegative());

export const otherChargeSchema = z.object({
  date: z.string().trim().min(1, "Date required"),
  vendorId: z.string().trim().min(1, "Vendor required"),
  direction: z.enum(["DEBIT", "CREDIT"]),
  model: z.string().trim().toUpperCase().min(1, "Pick a model").max(30),
  reason: z.string().trim().min(1, "Reason required").max(200),
  taxable: numericString("Taxable amount"),
  gstRate: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? Number(v) : 0))
    .pipe(z.number().min(0).max(100)),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type OtherChargeInput = z.infer<typeof otherChargeSchema>;
