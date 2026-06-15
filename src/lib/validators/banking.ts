import { z } from "zod";

export const BANK_TYPES = ["SAVINGS", "CURRENT", "OD", "CASH"] as const;
export type BankType = (typeof BANK_TYPES)[number];

export const bankAccountSchema = z.object({
  name: z.string().trim().min(2, "Name required"),
  bankName: z.string().trim().min(2, "Bank name required"),
  accountNo: z.string().trim().min(1, "Account number required"),
  ifsc: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  branch: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  type: z.enum(BANK_TYPES).default("CURRENT"),
  currency: z.string().trim().default("INR"),
  openingBalance: z.coerce.number().default(0),
  openingAsOf: z.string().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  isActive: z.coerce.boolean().default(true),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export const BANK_TXN_TYPES = ["RECEIPT", "PAYMENT", "CHARGE", "INTEREST", "TRANSFER"] as const;
export type BankTxnType = (typeof BANK_TXN_TYPES)[number];

/** Counter party is resolved server-side: when type=RECEIPT and customerId
 *  is set, ensureCustomerCoA(customerId) gives contraAccountId. Same idea
 *  for PAYMENT+vendorId. For TRANSFER, contraBankAccountId is required.
 *  For CHARGE/INTEREST, a default CoA is used unless contraAccountCode
 *  is provided explicitly. */
export const bankTransactionSchema = z
  .object({
    bankAccountId: z.string().min(1, "Bank account required"),
    date: z.string().min(1, "Date required"),
    type: z.enum(BANK_TXN_TYPES),
    amount: z.coerce.number().positive("Amount must be > 0"),
    refNo: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    narration: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    customerId: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    vendorId: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    contraBankAccountId: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    /** Optional override CoA code for the contra side. If absent, server
     *  picks a sensible default per type (e.g. 4220 for misc RECEIPT). */
    contraAccountCode: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => v.type !== "TRANSFER" || !!v.contraBankAccountId, {
    message: "Destination bank required for TRANSFER",
    path: ["contraBankAccountId"],
  })
  .refine((v) => v.type !== "TRANSFER" || v.contraBankAccountId !== v.bankAccountId, {
    message: "Destination must differ from source",
    path: ["contraBankAccountId"],
  });
export type BankTransactionInput = z.infer<typeof bankTransactionSchema>;
