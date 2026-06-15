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

export const stockAdjustmentSchema = z.object({
  date: z.string().trim().min(1, "Date required"),
  itemId: z.string().trim().min(1, "Pick an item"),
  warehouseId: optionalStr,
  direction: z.enum(["ADD", "REMOVE"]),
  qty: numericString("Qty").pipe(z.number().positive("Qty must be greater than 0")),
  reason: z.string().trim().min(1, "Reason required").max(200),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
