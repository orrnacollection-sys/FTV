import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be ≥ 16 chars"),
  AUTH_TRUST_HOST: z.string().optional(),
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  CRON_SECRET: z.string().optional(),
  /**
   * Cutover date for the FTV ledger rework: GRNs against ON_SALE models
   * (FTV / FTV_NORETURN) only post to the vendor ledger when grnDate >= this
   * date. Settings before this date keep the legacy "credit-on-sale" behaviour
   * implicit in earlier data. ISO YYYY-MM-DD; defaults to 2026-04-01 so the
   * shipped demo data exercises the new logic. Override in .env per environment.
   */
  FTV_LEDGER_CUTOVER_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-04-01"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast — don't let the app boot with bad env.
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment");
}

export const env = parsed.data;
