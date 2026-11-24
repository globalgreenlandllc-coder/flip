"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProviders, isDemoProvider } from "@/lib/data";
import { MAX_SAVED_DEALS, dealTitle, type DealPayload } from "@/lib/deals";

const VERDICTS = new Set(["GO", "TIGHT", "PASS"]);
const MAX_PAYLOAD_CHARS = 900_000;

/**
 * A result, not a throw: in a production build the message of an error thrown
 * from a server action never reaches the browser (it gets a digest), so
 * anything the person should read has to come back as a value.
 */
export type SaveDealResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveDeal(payload: DealPayload): Promise<SaveDealResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to save deals." };

  // The payload comes from the browser: hold it to the shape of a report before it is stored.
  const deal = payload?.report?.deal;
  const arv = payload?.report?.arv?.point;
  if (!deal || !VERDICTS.has(deal.verdict) || ![deal.purchasePrice, deal.maxAllowableOffer, deal.profit, arv].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return { ok: false, error: "That result could not be saved. Run the analysis again." };
  }
  const stored = JSON.stringify(payload);
  if (stored.length > MAX_PAYLOAD_CHARS) return { ok: false, error: "That result is too large to save." };
  if ((await db.deal.count({ where: { userId } })) >= MAX_SAVED_DEALS) return { ok: false, error: `You have ${MAX_SAVED_DEALS} saved deals, the most an account keeps. Delete some to save more.` };

  // While this server only has made-up market data, nothing it saves can be anything but a demo,
  // whatever the browser says. Once real data exists the browser's word is all there is for a
  // result it computed earlier: before a deal can be shared with anyone else, this must be
  // re-derived on the server.
  const provider = isDemoProvider(getProviders().name) || typeof payload.provider !== "string" ? "synthetic" : payload.provider.slice(0, 60);

  const { report } = payload;
  const row = await db.deal.create({
    data: {
      userId,
      title: dealTitle(payload).slice(0, 300),
      source: typeof payload.listing?.url === "string" ? payload.listing.url.slice(0, 2_000) : null,
      askingPrice: report.deal.purchasePrice,
      verdict: report.deal.verdict,
      arv: report.arv.point,
      maxOffer: report.deal.maxAllowableOffer,
      profit: report.deal.profit,
      provider,
      payload: stored,
    },
  });
  revalidatePath("/app/deals");
  return { ok: true, id: row.id };
}

export async function deleteDeal(id: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in first.");
  await db.deal.deleteMany({ where: { id, userId } });
  revalidatePath("/app/deals");
  redirect("/app/deals");
}
