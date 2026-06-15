#!/usr/bin/env node
/**
 * One-shot schema migration for #133 — add `companyId` to operational
 * models. Reads prisma/schema.prisma, mutates it, writes it back.
 *
 *   node prisma/add-company-id.mjs
 *
 * Operational models that get companyId (and `@@index([companyId])`):
 *   Vendor, Category, Item, Warehouse, Customer, PurchaseOrder, GRN,
 *   Sale, Payment, WarehouseTransfer, OtherCharge, StockAdjustment,
 *   OrPayment, MarketplaceOrder, MarketingCost, MarketplaceRate,
 *   Series, ChartOfAccount, JournalEntry, BankAccount, BankTransaction
 *
 * Stay global (not touched):
 *   User, VendorInvite, ItemPriceRevision, Company, CompanyGSTIN,
 *   CompanyGSTINPlace, TaxComponent, HsnRate, ModelMaster, Unit,
 *   PurchaseOrderItem, GRNItem, EmailOTP, AuditLog, JournalLine,
 *   BankStatementLine, GSTR2BLine, BankReceiptAllocation
 *
 * The script is idempotent: if `companyId` already exists in a model,
 * the model is skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  "Vendor",
  "Category",
  "Item",
  "Warehouse",
  "Customer",
  "PurchaseOrder",
  "GRN",
  "Sale",
  "Payment",
  "WarehouseTransfer",
  "OtherCharge",
  "StockAdjustment",
  "OrPayment",
  "MarketplaceOrder",
  "MarketingCost",
  "MarketplaceRate",
  "Series",
  "ChartOfAccount",
  "JournalEntry",
  "BankAccount",
  "BankTransaction",
];

const FIELD_BLOCK = `
  /// Multi-company scope (#133). Nullable for backfill — flipped to
  /// NOT NULL once \`prisma/backfill-company-id.mjs\` runs.
  companyId      String?
  company        Company? @relation(fields: [companyId], references: [id], onDelete: Restrict)`;

const path = new URL("./schema.prisma", import.meta.url);
let text = readFileSync(path, "utf8");

// For each model, locate the model body and:
//   1. Insert FIELD_BLOCK after the line that declares `id` (and the
//      blank line that usually follows the existing single-line fields).
//   2. Add `@@index([companyId])` just before the closing `}`.
//
// We split into model blocks first because regex on the whole file is
// brittle with so many `}` closing braces.

const segments = [];
let pos = 0;
const modelRe = /^model\s+(\w+)\s*{/gm;
let m;
while ((m = modelRe.exec(text)) !== null) {
  if (m.index > pos) segments.push({ kind: "between", text: text.slice(pos, m.index) });
  const headerStart = m.index;
  // Find the matching closing `}` (no nested braces in Prisma model bodies).
  const bodyStart = headerStart + m[0].length;
  const closeRel = text.indexOf("\n}", bodyStart);
  if (closeRel === -1) throw new Error(`Unclosed model ${m[1]} at ${headerStart}`);
  const blockEnd = closeRel + 2;
  segments.push({
    kind: "model",
    name: m[1],
    text: text.slice(headerStart, blockEnd),
  });
  pos = blockEnd;
  modelRe.lastIndex = pos;
}
if (pos < text.length) segments.push({ kind: "between", text: text.slice(pos) });

let touched = 0;
let skipped = 0;
for (const seg of segments) {
  if (seg.kind !== "model") continue;
  if (!TARGETS.includes(seg.name)) continue;
  if (/^\s*companyId\b/m.test(seg.text)) {
    skipped++;
    continue;
  }

  // 1. Insert FIELD_BLOCK after the id line.
  const idLineRe = /^(\s*id\s+String\s+@id\s+@default\(cuid\(\)\)[^\n]*)$/m;
  if (!idLineRe.test(seg.text)) {
    console.error(`  ! ${seg.name}: no id line matched — skipping field insert`);
    continue;
  }
  seg.text = seg.text.replace(idLineRe, `$1${FIELD_BLOCK}`);

  // 2. Add @@index([companyId]) right before the closing `}`. Find the
  //    last `@@` block; if there is one, append after it. Otherwise add
  //    just before the final newline + `}`.
  const lines = seg.text.split("\n");
  let insertIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith("@@")) { insertIdx = i + 1; break; }
  }
  if (insertIdx === -1) {
    // No existing @@index — insert just before the final `}` line.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === "}") { insertIdx = i; break; }
    }
  }
  if (insertIdx === -1) {
    console.error(`  ! ${seg.name}: could not find insert position for @@index`);
    continue;
  }
  lines.splice(insertIdx, 0, "  @@index([companyId])");
  seg.text = lines.join("\n");
  touched++;
  console.log(`  + ${seg.name}`);
}

const out = segments.map((s) => s.text).join("");
writeFileSync(path, out, "utf8");
console.log(`\nAdded companyId to ${touched} model(s). Skipped (already present): ${skipped}.`);
