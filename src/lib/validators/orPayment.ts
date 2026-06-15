import { z } from "zod";

const numericString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => !Number.isNaN(Number(v)), `${label} must be a number`)
    .transform((v) => Number(v))
    .pipe(z.number().positive(`${label} must be greater than 0`));

export const orPaymentSchema = z.object({
  vendorId: z.string().trim().min(1, "Vendor required"),
  date: z.string().trim().min(1, "Date required"),
  amount: numericString("Amount"),
  reference: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  particulars: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
});

export type OrPaymentInput = z.infer<typeof orPaymentSchema>;
