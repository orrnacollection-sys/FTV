import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/rbac";
import { buildPdf } from "@/app/(admin)/purchase-orders/actions";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  if (me.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  let pdf: Buffer | null;
  try {
    pdf = await buildPdf(id);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!pdf) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="PO-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const runtime = "nodejs";
