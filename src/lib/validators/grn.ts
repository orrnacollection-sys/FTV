import { z } from "zod";

export const grnItemSchema = z.object({
  itemId: z.string().min(1, "Pick an item"),
  poItemId: z.string().optional().or(z.literal("").transform(() => undefined)),
  /** Existing GRNItem id when editing — undefined for new rows. */
  grnItemId: z.string().optional().or(z.literal("").transform(() => undefined)),
  qty: z.number().positive("Qty must be > 0"),
  rejectedQty: z.number().min(0, "≥ 0").default(0),
  rate: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100),
});

export const grnSchema = z.object({
  grnDate: z.string().min(1, "GRN date required"),
  type: z.enum(["PURCHASE", "RTV", "RFV"]),
  vendorId: z.string().min(1, "Vendor required"),
  warehouseId: z.string().min(1, "Warehouse required"),
  vendorInvoiceNo: z.string().optional().or(z.literal("").transform(() => undefined)),
  vendorInvoiceDate: z.string().optional().or(z.literal("").transform(() => undefined)),
  items: z.array(grnItemSchema).min(1, "At least one item required"),
});

export type GRNInput = z.infer<typeof grnSchema>;
