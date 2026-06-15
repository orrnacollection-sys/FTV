"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { parseFlexibleDate } from "@/lib/date";
import {
  createJournalEntry as createJournalEntryHelper,
  updateJournalEntry as updateJournalEntryHelper,
} from "@/lib/accounting";

type LineInput = { accountId: string; debit: number; credit: number; narration?: string };

export async function createJournalEntry(input: {
  date: string;
  narration?: string;
  lines: LineInput[];
}): Promise<{ ok: true; id: string; voucherNo: string } | { ok: false; error: string }> {
  const me = await requireAdmin();
  const date = parseFlexibleDate(input.date);
  if (!date) return { ok: false, error: "Invalid date" };

  const res = await createJournalEntryHelper({
    date,
    narration: input.narration,
    lines: input.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      narration: l.narration,
    })),
    source: "MANUAL",
    createdBy: me.id,
  });
  if (!res.ok) return res;

  await logWrite("JournalEntry", res.id, "CREATE", null, { voucherNo: res.voucherNo, ...input });
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/pnl");
  revalidatePath("/accounting/balance-sheet");
  return res;
}

export async function updateJournalEntry(input: {
  id: string;
  date: string;
  narration?: string;
  lines: LineInput[];
}): Promise<{ ok: true; id: string; voucherNo: string } | { ok: false; error: string }> {
  await requireAdmin();
  const date = parseFlexibleDate(input.date);
  if (!date) return { ok: false, error: "Invalid date" };

  const before = await prisma.journalEntry.findUnique({
    where: { id: input.id },
    select: { voucherNo: true, source: true, date: true, narration: true },
  });

  const res = await updateJournalEntryHelper({
    id: input.id,
    date,
    narration: input.narration,
    lines: input.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      narration: l.narration,
    })),
  });
  if (!res.ok) return res;

  await logWrite("JournalEntry", res.id, "UPDATE", before, { voucherNo: res.voucherNo, ...input });
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/pnl");
  revalidatePath("/accounting/balance-sheet");
  return res;
}

export async function deleteJournalEntry(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const before = await prisma.journalEntry.findUnique({
    where: { id },
    select: { voucherNo: true, source: true },
  });
  if (!before) return { ok: false, error: "Entry not found" };
  if (before.source !== "MANUAL") {
    return { ok: false, error: `Cannot delete a ${before.source} entry — undo it at the source instead.` };
  }
  await prisma.journalEntry.delete({ where: { id } }); // cascade kills lines
  await logWrite("JournalEntry", id, "DELETE", before, null);
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/pnl");
  revalidatePath("/accounting/balance-sheet");
  return { ok: true };
}
