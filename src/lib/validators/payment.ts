import { z } from "zod";
import { MODELS } from "@/lib/constants";

export const paymentStatusSchema = z
  .object({
    vendorId: z.string().min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
    model: z.enum(MODELS),
    amountPaid: z.coerce.number().min(0).default(0),
    status: z.enum(["PENDING", "PARTIAL", "PAID"]),
    utr: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    remarks: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    paidOn: z.string().optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => !(v.status === "PAID" && v.amountPaid <= 0), {
    message: "PAID requires amount paid > 0",
    path: ["amountPaid"],
  })
  .refine((v) => !(v.status === "PENDING" && v.amountPaid > 0), {
    message: "If any amount paid, use PARTIAL or PAID",
    path: ["status"],
  })
  .refine((v) => !(v.status === "PAID" && !v.utr), {
    message: "UTR required when status is PAID",
    path: ["utr"],
  });

export type PaymentStatusInput = z.infer<typeof paymentStatusSchema>;
