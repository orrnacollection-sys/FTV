"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, useMemo } from "react";
import { toast } from "react-hot-toast";
import {
  BANK_TXN_TYPES,
  type BankTxnType,
} from "@/lib/validators/banking";
import { createBankTransaction } from "../actions";

type Bank = { id: string; name: string; type: string };
type Customer = { id: string; name: string };
type Vendor = { id: string; label: string };
type CoA = { code: string; name: string; type: string };

type Props = {
  banks: Bank[];
  customers: Customer[];
  vendors: Vendor[];
  coa: CoA[];
};

const TYPE_HELP: Record<BankTxnType, string> = {
  RECEIPT: "Money in — usually from a customer. Bank ↑.",
  PAYMENT: "Money out — usually to a vendor. Bank ↓.",
  CHARGE: "Bank fees / GST debited by the bank.",
  INTEREST: "Interest credited by the bank.",
  TRANSFER: "Inter-account move. Source ↓, destination ↑.",
};

export function TxnForm({ banks, customers, vendors, coa }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [errs, setErrs] = useState<Record<string, string>>({});

  const [type, setType] = useState<BankTxnType>("RECEIPT");
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10).split("-").reverse().join("-"));
  const [amount, setAmount] = useState("");
  const [refNo, setRefNo] = useState("");
  const [narration, setNarration] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [contraBankAccountId, setContraBankAccountId] = useState("");
  const [contraAccountCode, setContraAccountCode] = useState("");

  const coaForType = useMemo(() => {
    // Helpful subset: for RECEIPT show INCOME accounts; PAYMENT show EXPENSE; etc.
    if (type === "RECEIPT" || type === "INTEREST") return coa.filter((c) => c.type === "INCOME");
    if (type === "PAYMENT" || type === "CHARGE") return coa.filter((c) => c.type === "EXPENSE");
    return [];
  }, [type, coa]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrs({});
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createBankTransaction(fd);
      if ("error" in r && r.error) {
        if (r.fieldErrors) setErrs(r.fieldErrors);
        toast.error(r.error);
        return;
      }
      toast.success("Transaction recorded · JV posted");
      router.push("/banking/transactions");
      router.refresh();
    });
  }

  const showCustomer = type === "RECEIPT";
  const showVendor = type === "PAYMENT";
  const showContraBank = type === "TRANSFER";
  const showContraCoa = type !== "TRANSFER" && (
    (type === "RECEIPT" && !customerId) ||
    (type === "PAYMENT" && !vendorId) ||
    type === "CHARGE" ||
    type === "INTEREST"
  );

  return (
    <form onSubmit={submit} className="card max-w-3xl">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">
        Transaction Details
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Type *">
          <select
            name="type"
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as BankTxnType);
              setContraAccountCode("");
              setCustomerId("");
              setVendorId("");
              setContraBankAccountId("");
            }}
          >
            {BANK_TXN_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">{TYPE_HELP[type]}</p>
        </Field>

        <Field label="Bank Account *" err={errs.bankAccountId}>
          <select
            name="bankAccountId"
            className="input"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            required
          >
            <option value="">— Select —</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.type})</option>
            ))}
          </select>
        </Field>

        <Field label="Date *" err={errs.date}>
          <input
            name="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="DD-MM-YYYY"
            required
          />
        </Field>

        <Field label="Amount ₹ *" err={errs.amount}>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            className="input text-right font-mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>

        {showCustomer && (
          <Field label="Customer (clears their A/R)" className="sm:col-span-2">
            <select
              name="customerId"
              className="input"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">— None (use Other CoA below) —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}

        {showVendor && (
          <Field label="Vendor (clears their A/P)" className="sm:col-span-2">
            <select
              name="vendorId"
              className="input"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">— None (use Other CoA below) —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </Field>
        )}

        {showContraBank && (
          <Field label="To Bank Account *" err={errs.contraBankAccountId} className="sm:col-span-2">
            <select
              name="contraBankAccountId"
              className="input"
              value={contraBankAccountId}
              onChange={(e) => setContraBankAccountId(e.target.value)}
              required
            >
              <option value="">— Select destination —</option>
              {banks.filter((b) => b.id !== bankAccountId).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        )}

        {showContraCoa && (
          <Field
            label={`Other CoA (${type === "CHARGE" ? "default: 5280 Bank Charges" : type === "INTEREST" ? "default: 4210 Interest Income" : type === "RECEIPT" ? "default: 4220 Misc Income" : "default: 5300 Other Expenses"})`}
            className="sm:col-span-2"
          >
            <select
              name="contraAccountCode"
              className="input"
              value={contraAccountCode}
              onChange={(e) => setContraAccountCode(e.target.value)}
            >
              <option value="">— Use default —</option>
              {coaForType.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Reference No (UTR / Cheque)">
          <input
            name="refNo"
            className="input"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            placeholder="UTR1234567890"
          />
        </Field>

        <Field label="Narration">
          <input
            name="narration"
            className="input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Optional context"
          />
        </Field>
      </div>

      <div className="border-t border-border bg-paper-cream/60 px-4 py-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => router.back()}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !bankAccountId}>
          {busy ? "Posting…" : "Record + Post JV"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  err,
  className = "",
  children,
}: {
  label: string;
  err?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">{label}</span>
      {children}
      {err ? <span className="block text-xs text-rose-600 mt-1">{err}</span> : null}
    </label>
  );
}
