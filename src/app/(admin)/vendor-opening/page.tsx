import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { toDisplayDate } from "@/lib/date";
import { VendorOpeningImport } from "./VendorOpeningImport";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function VendorOpeningPage() {
  const scope = await companyWhere();
  const rows = await prisma.vendorOpeningBalance.findMany({
    where: { ...scope },
    select: {
      model: true, amount: true, drCr: true, asOf: true,
      vendor: { select: { code: true, name: true } },
    },
    orderBy: [{ vendor: { name: "asc" } }, { model: "asc" }],
  });

  let totalCr = 0;
  let totalDr = 0;
  for (const r of rows) {
    if (r.drCr === "CR") totalCr += r.amount; else totalDr += r.amount;
  }
  const net = totalCr - totalDr;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Vendor Opening Balances</h1>
        <p className="text-sm text-ink-faint">
          Import each vendor&rsquo;s real opening balance per model (OR / FTV) — independent of inventory.
          Feeds the Vendor Ledger and the OR / FTV Payment screens so they open from the right figure.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rows" value={String(rows.length)} />
        <Stat label="We owe (CR)" value={money(totalCr)} tone="cr" />
        <Stat label="Advances (DR)" value={money(totalDr)} tone="dr" />
        <Stat label="Net payable" value={money(net)} />
      </div>

      <VendorOpeningImport />

      {rows.length > 0 && (
        <div className="mt-6 card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Dr/Cr</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">As of</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="px-3 py-2">{r.vendor.code ? `${r.vendor.code} · ` : ""}{r.vendor.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.drCr === "CR" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                      {r.drCr}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{toDisplayDate(r.asOf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "cr" | "dr" }) {
  const ring = tone === "cr" ? "border-amber-200" : tone === "dr" ? "border-sky-200" : "border-border";
  return (
    <div className={`rounded-lg border ${ring} bg-surface p-3`}>
      <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
