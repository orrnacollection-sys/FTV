/**
 * Tax resolver — the single brain that decides which GST components apply
 * to a transaction and at what amounts.
 *
 * Inputs: HSN, transaction date, ship-from state, ship-to state, taxable
 *         amount, plus a few flags (export, govt-buyer, e-com).
 *
 * Output: A breakdown of every component (CGST, SGST, IGST, UTGST, CESS)
 *         with the rate and the rupee value, plus the supplyType marker
 *         that drives GSTR-1 row assignment later.
 *
 * Resolution chain:
 *   1. Find the HsnRate row for this HSN whose effectiveFrom ≤ txDate,
 *      most recent wins. No row → fall back to a 0% REGULAR placeholder
 *      and flag the breakdown as `unresolved` so the caller can show a
 *      warning.
 *   2. Non-taxable supply types (ZERO_RATED, NIL_RATED, EXEMPT, NON_GST)
 *      short-circuit to zero components with the right marker.
 *   3. Reverse-charge rows emit the *_RCM component codes (buyer pays).
 *   4. Place-of-supply classification:
 *        from === to + !fromIsUT → CGST + SGST (slab/2 each)
 *        from === to +  fromIsUT → CGST + UTGST
 *        from !== to             → IGST (full slab)
 *   5. Compensation cess is added on top whenever cessRate > 0.
 */
import { prisma } from "@/lib/db";
import { isUnionTerritory } from "@/lib/constants";

export type TaxBreakdownLine = {
  code: string;          // CGST | SGST | IGST | UTGST | CESS | *_RCM
  name: string;
  rate: number;          // percent applied to base
  amount: number;        // rupee value (rounded to 2 decimals)
};

export type TaxBreakdown = {
  hsn: string;
  base: number;
  supplyType: string;    // REGULAR | ZERO_RATED | NIL_RATED | EXEMPT | NON_GST
  isReverseCharge: boolean;
  /** True when no HsnRate row matched — caller should warn admin. */
  unresolved: boolean;
  rateUsed: number;      // slab percent used (0 for non-taxable)
  cessUsed: number;
  /** Detailed component rows for invoice display + GL posting. */
  components: TaxBreakdownLine[];
  /** Pre-summed totals — convenience for forms. */
  totalTax: number;
  total: number;         // base + totalTax
};

export type ResolveInput = {
  hsn: string;
  /** Transaction date. Defaults to now. */
  date?: Date;
  /** Ship-from / origin state (typically the warehouse's state). */
  fromState: string | null | undefined;
  /** Ship-to / place-of-supply state (typically the customer's state). */
  toState: string | null | undefined;
  /** Taxable amount before tax. */
  base: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve the full GST breakdown for one taxable line. */
export async function resolveTaxBreakdown(input: ResolveInput): Promise<TaxBreakdown> {
  const date = input.date ?? new Date();

  // 1. Look up the effective rate. Most recent row whose effectiveFrom
  //    is ≤ date. Inactive rows are ignored.
  const rate = await prisma.hsnRate.findFirst({
    where: {
      hsn: input.hsn,
      isActive: true,
      effectiveFrom: { lte: date },
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (!rate) {
    return {
      hsn: input.hsn,
      base: round2(input.base),
      supplyType: "REGULAR",
      isReverseCharge: false,
      unresolved: true,
      rateUsed: 0,
      cessUsed: 0,
      components: [],
      totalTax: 0,
      total: round2(input.base),
    };
  }

  // 2. Non-taxable supply types collapse to zeros but keep their marker.
  if (rate.supplyType !== "REGULAR") {
    return {
      hsn: input.hsn,
      base: round2(input.base),
      supplyType: rate.supplyType,
      isReverseCharge: rate.isReverseCharge,
      unresolved: false,
      rateUsed: 0,
      cessUsed: 0,
      components: [],
      totalTax: 0,
      total: round2(input.base),
    };
  }

  // 3. Pick components based on place-of-supply.
  const intra = !!input.fromState && !!input.toState && input.fromState === input.toState;
  const fromIsUT = isUnionTerritory(input.fromState);
  const components: TaxBreakdownLine[] = [];

  const suffix = rate.isReverseCharge ? "_RCM" : "";

  if (intra) {
    const half = rate.slabRate / 2;
    const halfAmt = round2((input.base * half) / 100);
    components.push({ code: `CGST${suffix}`, name: rate.isReverseCharge ? "CGST — RCM" : "CGST", rate: half, amount: halfAmt });
    if (fromIsUT) {
      components.push({ code: `UTGST${suffix}`, name: rate.isReverseCharge ? "UTGST — RCM" : "UTGST", rate: half, amount: halfAmt });
    } else {
      components.push({ code: `SGST${suffix}`, name: rate.isReverseCharge ? "SGST — RCM" : "SGST", rate: half, amount: halfAmt });
    }
  } else if (input.fromState && input.toState) {
    const igstAmt = round2((input.base * rate.slabRate) / 100);
    components.push({ code: `IGST${suffix}`, name: rate.isReverseCharge ? "IGST — RCM" : "IGST", rate: rate.slabRate, amount: igstAmt });
  } else {
    // Missing place-of-supply state(s). Conservative fallback: treat as
    // IGST (worst case for tax payable, safest from undercollection).
    const igstAmt = round2((input.base * rate.slabRate) / 100);
    components.push({ code: `IGST${suffix}`, name: "IGST (assumed — set place of supply)", rate: rate.slabRate, amount: igstAmt });
  }

  // 4. Compensation cess on top, regardless of intra/inter.
  if (rate.cessRate > 0) {
    components.push({
      code: "CESS",
      name: "Compensation Cess",
      rate: rate.cessRate,
      amount: round2((input.base * rate.cessRate) / 100),
    });
  }

  const totalTax = round2(components.reduce((s, c) => s + c.amount, 0));

  return {
    hsn: input.hsn,
    base: round2(input.base),
    supplyType: rate.supplyType,
    isReverseCharge: rate.isReverseCharge,
    unresolved: false,
    rateUsed: rate.slabRate,
    cessUsed: rate.cessRate,
    components,
    totalTax,
    total: round2(input.base + totalTax),
  };
}

/** Cheap lookup for the current rate of an HSN (for showing on Item form). */
export async function getCurrentRateForHsn(hsn: string, date: Date = new Date()) {
  return prisma.hsnRate.findFirst({
    where: { hsn, isActive: true, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: "desc" },
    select: { slabRate: true, cessRate: true, supplyType: true, isReverseCharge: true, effectiveFrom: true },
  });
}
