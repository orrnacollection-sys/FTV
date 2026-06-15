import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { toDisplayDate } from "@/lib/date";
import { OpeningStockImport } from "./OpeningStockImport";
import { ItemStockImport } from "./ItemStockImport";
import { PostOpeningBalances } from "./PostOpeningBalances";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function OpeningStockPage() {
  const scope = await companyWhere();
  const grns = await prisma.gRN.findMany({
    where: { ...scope, isOpening: true },
    select: {
      grnNo: true,
      grnDate: true,
      openingPaid: true,
      vendor: { select: { code: true, name: true } },
      warehouse: { select: { code: true, name: true } },
      items: {
        select: {
          qty: true,
          rate: true,
          taxRate: true,
          model: true,
          taxableValue: true,
          item: { select: { skuCode: true, name: true } },
        },
      },
    },
    orderBy: [{ vendor: { name: "asc" } }, { grnNo: "asc" }],
  });

  type Line = {
    sku: string; name: string; vendorCode: string | null; vendorName: string;
    qty: number; cost: number; model: string; gst: number; warehouse: string;
    payment: "PAID" | "PENDING"; date: Date; value: number; grnNo: string;
  };
  const lines: Line[] = [];
  let totalQty = 0;
  let paidValue = 0;
  let pendingValue = 0;
  for (const g of grns) {
    for (const it of g.items) {
      totalQty += it.qty;
      if (g.openingPaid) paidValue += it.taxableValue; else pendingValue += it.taxableValue;
      lines.push({
        sku: it.item.skuCode,
        name: it.item.name,
        vendorCode: g.vendor.code,
        vendorName: g.vendor.name,
        qty: it.qty,
        cost: it.rate,
        model: it.model ?? "",
        gst: it.taxRate,
        warehouse: g.warehouse ? (g.warehouse.code ?? g.warehouse.name) : "—",
        payment: g.openingPaid ? "PAID" : "PENDING",
        date: g.grnDate,
        value: it.taxableValue,
        grnNo: g.grnNo,
      });
    }
  }
  const totalValue = paidValue + pendingValue;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Opening Stock (Go-Live)</h1>
        <p className="text-sm text-ink-faint">
          Load on-hand stock as of your go-live date. Each lot carries its own vendor, cost, and paid/pending
          status. Stock and FIFO valuation update immediately; the books (Inventory asset, vendor payables,
          Opening Equity) are posted in the next step.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Opening GRNs" value={String(grns.length)} />
        <Stat label="Lots / lines" value={String(lines.length)} />
        <Stat label="Units on hand" value={totalQty.toLocaleString("en-IN")} />
        <Stat label="Stock value (cost)" value={money(totalValue)} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:max-w-md">
        <Stat label="Already paid" value={money(paidValue)} tone="paid" />
        <Stat label="Payable (pending)" value={money(pendingValue)} tone="pending" />
      </div>

      <ItemStockImport />

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-faint hover:text-ink">
          Advanced — load stock only (when the items already exist)
        </summary>
        <div className="mt-2">
          <OpeningStockImport />
        </div>
      </details>

      {lines.length > 0 && <PostOpeningBalances />}

      {lines.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Imported opening-stock lines</h2>
            <span className="text-xs text-ink-faint">{lines.length.toLocaleString("en-IN")} line(s)</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2 text-right">GST %</th>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">GRN No</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.grnNo}-${l.sku}-${i}`} className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{l.sku}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2">{l.vendorCode ? `${l.vendorCode} · ` : ""}{l.vendorName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.qty.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.cost)}</td>
                    <td className="px-3 py-2">{l.model}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.gst}</td>
                    <td className="px-3 py-2">{l.warehouse}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${l.payment === "PAID" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {l.payment}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{toDisplayDate(l.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.value)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.grnNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "paid" | "pending" }) {
  const ring = tone === "paid" ? "border-emerald-200" : tone === "pending" ? "border-amber-200" : "border-border";
  return (
    <div className={`rounded-lg border ${ring} bg-surface p-3`}>
      <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
