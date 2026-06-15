"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { PERIOD_COOKIE } from "@/lib/period";

/** Set the active reporting period (Tally Alt+F2). `fromIso`/`toIso` are
 *  yyyy-mm-dd. Revalidates the whole layout so every report picks it up. */
export async function setPeriod(fromIso: string, toIso: string): Promise<void> {
  const store = await cookies();
  store.set(PERIOD_COOKIE, `${fromIso}|${toIso}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
