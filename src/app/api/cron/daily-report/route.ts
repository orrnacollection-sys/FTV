import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { sanitizeCell } from "@/lib/csv";
import { toDisplayDate } from "@/lib/date";

export const runtime = "nodejs";
// Vercel Cron triggers daily — see vercel.json. Endpoint also callable manually
// with `Authorization: Bearer <CRON_SECRET>` (if set) for ad-hoc runs.

function csvEscape(v: unknown): string {
  const s = String(sanitizeCell(v));
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Refuse to run in prod without a token — better to fail loud than leak data.
      return new NextResponse("Cron not configured", { status: 503 });
    }
    console.warn("[cron/daily-report] CRON_SECRET unset — dev mode only");
  } else if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Cron fires at 18:30 UTC = 00:00 IST. We report the previous Indian calendar
  // day — [yesterday 00:00 IST, today 00:00 IST), expressed in UTC.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const istMidnightTodayUtc = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()) - IST_OFFSET_MS);
  const start = new Date(istMidnightTodayUtc.getTime() - 24 * 60 * 60 * 1000);
  const end = istMidnightTodayUtc;

  const sales = await prisma.sale.findMany({
    where: { vchDate: { gte: start, lt: end } },
    include: {
      item: { select: { skuCode: true, name: true, vendor: { select: { model: true } } } },
    },
  });
  if (sales.length === 0) {
    return NextResponse.json({ window: { start, end }, vendorsNotified: 0, results: [] });
  }

  const vendorIds = [...new Set(sales.map((s) => s.vendorId))];
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true, email: true },
  });
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const byVendor = new Map<string, typeof sales>();
  for (const s of sales) {
    const cur = byVendor.get(s.vendorId);
    if (cur) cur.push(s);
    else byVendor.set(s.vendorId, [s]);
  }

  const results: { vendor: string; rows: number; emailId?: string; skipped?: string }[] = [];
  for (const [vendorId, rows] of byVendor) {
    const vendor = vendorById.get(vendorId);
    if (!vendor) continue;
    if (!vendor.email) {
      results.push({ vendor: vendor.name, rows: rows.length, skipped: "no email" });
      continue;
    }

    const headers = ["Date", "SKU", "Item", "Model", "Marketplace", "Type", "Sold", "Return", "RTO", "Rate", "Amount", "GST", "Total"];
    const lines = [headers.map(csvEscape).join(",")];
    let totalAmount = 0;
    let totalGst = 0;
    for (const s of rows) {
      const netQty = s.qtySold - s.qtyReturn;
      const amount = netQty * s.unitRate;
      const gst = (amount * s.taxRate) / 100;
      totalAmount += amount;
      totalGst += gst;
      lines.push([
        toDisplayDate(s.vchDate),
        s.item.skuCode,
        s.item.name,
        s.model ?? s.item.vendor.model ?? "",
        s.marketplace,
        s.transactionType,
        s.qtySold, s.qtyReturn, s.qtyRTO,
        s.unitRate.toFixed(2),
        amount.toFixed(2),
        gst.toFixed(2),
        (amount + gst).toFixed(2),
      ].map(csvEscape).join(","));
    }
    const csv = lines.join("\n");
    const dateLabel = toDisplayDate(start);
    try {
      const r = await sendEmail({
        to: vendor.email,
        subject: `Daily sales report — ${dateLabel}`,
        text: `Hello ${vendor.name},\n\nAttached is your sales summary for ${dateLabel}.\n\nNet amount: ${totalAmount.toFixed(2)}\nGST: ${totalGst.toFixed(2)}\nTotal: ${(totalAmount + totalGst).toFixed(2)}\n\n— Adwitiya Global`,
        attachments: [{ filename: `sales-${dateLabel}.csv`, content: Buffer.from(csv, "utf8"), contentType: "text/csv" }],
      });
      results.push({ vendor: vendor.name, rows: rows.length, emailId: r.id });
    } catch (e) {
      results.push({ vendor: vendor.name, rows: rows.length, skipped: e instanceof Error ? e.message : "send failed" });
    }
  }

  return NextResponse.json({
    window: { start: start.toISOString(), end: end.toISOString() },
    vendorsNotified: results.filter((r) => r.emailId).length,
    results,
  });
}
