import { z } from "zod";
import { INDIAN_STATES, PINCODE_REGEX, WAREHOUSE_TYPES, COUNTRIES } from "@/lib/constants";

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  address: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  city: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  state: z.enum(INDIAN_STATES).optional().or(z.literal("").transform(() => undefined)),
  pincode: z
    .string()
    .trim()
    .regex(PINCODE_REGEX, "6-digit pincode, first digit 1-9")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  country: z.enum(COUNTRIES).optional().or(z.literal("").transform(() => undefined)),
  // Same GSTIN regex used on the Vendor side — 15-char standard format.
  gst: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/, "Invalid GST")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  type: z.enum(WAREHOUSE_TYPES).default("OWN"),
  // When type=THIRD_PARTY, vendorId is required. Server action enforces.
  vendorId: z.string().optional().or(z.literal("").transform(() => undefined)),
}).refine(
  (v) => v.type !== "THIRD_PARTY" || !!v.vendorId,
  { message: "Vendor is required for third-party warehouses", path: ["vendorId"] },
).refine(
  (v) => v.type !== "OWN" || !v.vendorId,
  { message: "OWN warehouses cannot have a vendor", path: ["vendorId"] },
);

export type WarehouseInput = z.infer<typeof warehouseSchema>;
