import { Resend } from "resend";

/**
 * Email sender.
 *
 * - If `RESEND_API_KEY` is set, sends via Resend.
 * - Otherwise logs to the dev console.
 *
 * Call signature mirrors Resend's input so the only difference between dev
 * and prod is the env var. `from` defaults to `RESEND_FROM_EMAIL` if unset.
 */

export type EmailAttachment = {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
};

export type SendEmailInput = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  from?: string;
};

let cachedClient: Resend | null = null;
function client() {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!process.env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL must be set when RESEND_API_KEY is configured");
  }
  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const c = client();
  const from = input.from ?? process.env.RESEND_FROM_EMAIL ?? "no-reply@adwitiya.example";

  if (c) {
    const to = Array.isArray(input.to) ? input.to : [input.to];
    const cc = input.cc ? (Array.isArray(input.cc) ? input.cc : [input.cc]) : undefined;
    const result = await c.emails.send({
      from,
      to,
      cc,
      subject: input.subject,
      text: input.text ?? "",
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
      })),
    });
    if (result.error) {
      console.error("[email] Resend error:", result.error);
      throw new Error(result.error.message ?? "Email send failed");
    }
    return { id: result.data?.id ?? "" };
  }

  // Dev console stub.
  const id = `dev-${Date.now().toString(36)}`;
  console.log("\n────────── EMAIL (dev console stub) ──────────");
  console.log("ID:        ", id);
  console.log("To:        ", input.to);
  if (input.cc) console.log("CC:        ", input.cc);
  console.log("From:      ", from);
  console.log("Subject:   ", input.subject);
  if (input.attachments?.length) {
    console.log("Attached:  ", input.attachments.map((a) => `${a.filename} (${a.content.byteLength}B)`).join(", "));
  }
  if (input.text) {
    console.log("Body:");
    console.log(input.text.split("\n").map((l) => `  | ${l}`).join("\n"));
  }
  console.log("──────────────────────────────────────────────\n");
  return { id };
}
