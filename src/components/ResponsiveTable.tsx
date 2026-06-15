"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A list primitive that renders:
 *  • a normal HTML table at md+ (every column visible);
 *  • a stacked card-per-row layout below md (only the most-used fields shown,
 *    with an expand chevron that reveals the rest).
 *
 * Vendors are primarily on mobile, so this is the foundation that lets the
 * portal lists work on a 360px viewport without horizontal scroll.
 *
 * Usage:
 *
 *   <ResponsiveTable
 *     rows={rows}
 *     getRowKey={(r) => r.id}
 *     columns={[
 *       { key: "date",   header: "Date",   cell: (r) => fmt(r.date),  primary: true },
 *       { key: "amount", header: "Amount", cell: (r) => fmt(r.amount), primary: true, align: "right" },
 *       { key: "ref",    header: "Ref",    cell: (r) => r.ref },
 *       { key: "notes",  header: "Notes",  cell: (r) => r.notes },
 *     ]}
 *     empty={<div>Nothing here yet</div>}
 *   />
 *
 * Columns flagged primary={true} appear in the mobile card header; the rest
 * are tucked behind the expand chevron.
 */

export type RTColumn<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Show on the mobile card without expanding. Default false. */
  primary?: boolean;
  /** Hide entirely on mobile (e.g. row action buttons). Default false. */
  desktopOnly?: boolean;
  align?: "left" | "right" | "center";
  /** Optional explicit width for desktop, e.g. "w-24". */
  className?: string;
};

export function ResponsiveTable<T>({
  rows,
  columns,
  getRowKey,
  empty,
  onRowClick,
}: {
  rows: T[];
  columns: RTColumn<T>[];
  getRowKey: (row: T) => string;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-gray-100 p-8 text-center text-xs text-ink-faint">
        {empty ?? "No data."}
      </div>
    );
  }

  return (
    <>
      {/* Desktop: regular table. */}
      <div className="hidden md:block table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "th",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={getRowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn(
                  "hover:bg-brand-yellow-50/40",
                  onRowClick && "cursor-pointer",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "td",
                      c.align === "right" && "text-right tabular-nums",
                      c.align === "center" && "text-center",
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stack of cards. */}
      <div className="md:hidden space-y-2">
        {rows.map((r) => (
          <MobileCard
            key={getRowKey(r)}
            row={r}
            columns={columns}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          />
        ))}
      </div>
    </>
  );
}

function MobileCard<T>({
  row,
  columns,
  onClick,
}: {
  row: T;
  columns: RTColumn<T>[];
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const primary = columns.filter((c) => c.primary && !c.desktopOnly);
  const rest = columns.filter((c) => !c.primary && !c.desktopOnly);
  const hasRest = rest.length > 0;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => {
          if (hasRest) setOpen((o) => !o);
          else onClick?.();
        }}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        {hasRest && (
          <span className="mt-0.5 shrink-0 text-ink-faint">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        )}
        <div className="flex-1 min-w-0 space-y-0.5">
          {primary.length === 0 ? (
            // No primary flagged — fall back to the first 2 columns.
            <PrimaryRow columns={columns.slice(0, 2)} row={row} />
          ) : (
            <PrimaryRow columns={primary} row={row} />
          )}
        </div>
      </button>
      {hasRest && open && (
        <dl className="border-t border-border bg-surface-gray-100/50 px-3 py-2 text-xs space-y-1">
          {rest.map((c) => (
            <Fragment key={c.key}>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-faint">{c.header}</dt>
                <dd className={cn("text-ink", c.align === "right" && "tabular-nums")}>{c.cell(row)}</dd>
              </div>
            </Fragment>
          ))}
          {onClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              className="mt-2 w-full rounded border border-border bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider hover:bg-brand-yellow-pale"
            >
              Open
            </button>
          )}
        </dl>
      )}
    </div>
  );
}

function PrimaryRow<T>({ columns, row }: { columns: RTColumn<T>[]; row: T }) {
  return (
    <>
      {columns.map((c, i) => (
        <div
          key={c.key}
          className={cn(
            "flex items-baseline justify-between gap-3",
            i === 0 ? "text-sm font-medium" : "text-xs text-ink-mid",
          )}
        >
          <span className="truncate">{c.cell(row)}</span>
        </div>
      ))}
    </>
  );
}
