import { z } from "zod";

export const recordSaleSchema = z
  .object({
    vchDate: z.string().min(1, "Date required"),
    marketplace: z.string().trim().min(1, "Marketplace required").max(120),
    itemId: z.string().min(1, "Pick an item"),
    warehouseId: z.string().min(1, "Warehouse required"),
    transactionType: z.enum(["SALE", "RETURN"]),
    qtySold: z.coerce.number().min(0, "≥ 0").default(0),
    qtyReturn: z.coerce.number().min(0, "≥ 0").default(0),
    qtyRTO: z.coerce.number().min(0, "≥ 0").default(0),
    manualRemarks: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => v.qtySold > 0 || v.qtyReturn > 0 || v.qtyRTO > 0, {
    message: "At least one quantity must be greater than 0",
    path: ["qtySold"],
  });

export type RecordSaleInput = z.infer<typeof recordSaleSchema>;
