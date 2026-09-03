"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { dealTitle, type DealPayload } from "@/lib/deals";

export async function saveDeal(payload: DealPayload): Promise<{ id: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to save deals.");
  const { report } = payload;
  const deal = await db.deal.create({
    data: {
      userId,
      title: dealTitle(payload),
      source: payload.listing?.url ?? null,
      askingPrice: report.deal.purchasePrice,
      verdict: report.deal.verdict,
      arv: report.arv.point,
      maxOffer: report.deal.maxAllowableOffer,
      profit: report.deal.profit,
      payload: JSON.stringify(payload),
    },
  });
  revalidatePath("/app/deals");
  return { id: deal.id };
}

export async function deleteDeal(id: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in first.");
  await db.deal.deleteMany({ where: { id, userId } });
  revalidatePath("/app/deals");
  redirect("/app/deals");
}
