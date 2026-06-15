import { z } from "zod";

export const poItemSchema = z.object({
  // Optional existing PurchaseOrderItem id — set when the edit form sends a
  // row that came from the saved PO. Lets updatePO match payload rows to
  // existing receivedQty so it can enforce the received-line lock.
  poItemId: z.string().optional().or(z.literal("").transform(() => undefined)),
  itemId: z.string().min(1, "Pick an item"),
  qty: z.number().positive("Qty must be > 0"),
  rate: z.number().nonnegative("Rate must be ≥ 0"),
  taxRate: z.number().min(0).max(100),
});

export const poSchema = z.object({
  vendorId: z.string().min(1, "Vendor required"),
  poDate: z.string().min(1, "PO date required"),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1, "At least one item required"),
});

export type POInput = z.infer<typeof poSchema>;
