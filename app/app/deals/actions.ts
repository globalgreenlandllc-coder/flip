"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isDemoProvider, providerToSave } from "@/lib/data/demo";
import { rentcastFromEnv } from "@/lib/data/house-data";
import { MAX_SAVED_DEALS, dealColumns, dealTitle, type DealPayload } from "@/lib/deals";
import { scenarioFor } from "@/lib/api/scenario";
const MAX_PAYLOAD_CHARS = 900_000;

/**
 * A result, not a throw: in a production build the message of an error thrown
 * from a server action never reaches the browser (it gets a digest), so
 * anything the person should read has to come back as a value.
 */
export type SaveDealResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Save a result as a deal. `scenario`: the person's Deal Studio inputs, when they changed any; the server works their
 * numbers out again and keeps those with the deal (lib/api/scenario.ts). The deal's columns stay the analysis'.
 */
export async function saveDeal(payload: DealPayload, scenario?: unknown): Promise<SaveDealResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to save deals." };

  // The payload comes from the browser: hold it to the shape of a report before it is stored.
  const columns = dealColumns(payload?.report);
  const deal = payload?.report?.deal;
  if (!columns || !deal) return { ok: false, error: "That result could not be saved. Run the analysis again." };
  // What it is saved as is decided here, not by the browser (lib/data/demo.ts providerToSave): a demo, or a
  // result on real sold prices that is not a GO. Nothing else, so nothing saved is ever shown without its mark.
  // Before a deal can be shared with anyone else, the result itself must be re-derived on the server.
  const provider = providerToSave(payload.provider, deal.verdict, rentcastFromEnv() !== null);
  if (provider === null) return { ok: false, error: "That result could not be saved. Run the analysis again." };

  // Whatever scenario the browser put inside the payload is not taken; only the one worked out here, as what the deal
  // is saved as (demo or real sold prices) says.
  const { scenario: _ignored, ...rest } = payload;
  void _ignored;
  let toStore: DealPayload = rest;
  if (scenario !== undefined && scenario !== null) {
    const kept = scenarioFor(rest.report, scenario, { demo: isDemoProvider(provider), now: new Date() });
    if (!kept.ok) return { ok: false, error: kept.error };
    if (kept.scenario) toStore = { ...rest, scenario: kept.scenario };
  }
  const stored = JSON.stringify(toStore);
  if (stored.length > MAX_PAYLOAD_CHARS) return { ok: false, error: "That result is too large to save." };
  if ((await db.deal.count({ where: { userId } })) >= MAX_SAVED_DEALS) return { ok: false, error: `You have ${MAX_SAVED_DEALS} saved deals, the most an account keeps. Delete some to save more.` };

  const { report } = payload;
  const row = await db.deal.create({
    data: {
      userId,
      title: dealTitle(payload).slice(0, 300),
      source: typeof payload.listing?.url === "string" ? payload.listing.url.slice(0, 2_000) : null,
      askingPrice: report.deal.purchasePrice,
      verdict: report.deal.verdict,
      // The resale the deal was worked out on, so the card's margin is the result page's (lib/deals.ts dealColumns).
      arv: columns.arv,
      maxOffer: report.deal.maxAllowableOffer,
      profit: report.deal.profit,
      provider,
      payload: stored,
    },
  });
  revalidatePath("/app/deals");
  return { ok: true, id: row.id };
}

export type SaveScenarioResult = { ok: true; kept: boolean } | { ok: false; error: string };

/**
 * Keep the person's Deal Studio scenario with one of their saved deals, replacing the one kept before (one per deal).
 * The inputs are checked and the numbers worked out here, with the same engine; the analysis' own inputs remove the
 * scenario. Only the payload changes: the verdict, resale, maximum offer, profit and provider columns stay the
 * analysis'. Nothing here counts against the month, asks a data provider or the AI.
 */
export async function saveScenario(id: string, inputs: unknown): Promise<SaveScenarioResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to save a scenario." };
  if (typeof id !== "string" || id.length === 0 || id.length > 100) return { ok: false, error: "That deal could not be found." };
  const deal = await db.deal.findFirst({ where: { id, userId }, select: { id: true, payload: true, provider: true } });
  if (!deal) return { ok: false, error: "That deal could not be found." };
  let payload: DealPayload;
  try {
    payload = JSON.parse(deal.payload) as DealPayload;
  } catch {
    return { ok: false, error: "That deal could not be read." };
  }
  // Demo or not is the column's word, not the payload's (as the deal page reads it).
  const kept = scenarioFor(payload.report, inputs, { demo: isDemoProvider(deal.provider), now: new Date() });
  if (!kept.ok) return kept;
  const { scenario: _old, ...rest } = payload;
  void _old;
  const next: DealPayload = kept.scenario ? { ...rest, scenario: kept.scenario } : rest;
  const stored = JSON.stringify(next);
  if (stored.length > MAX_PAYLOAD_CHARS) return { ok: false, error: "That scenario is too large to save." };
  await db.deal.updateMany({ where: { id: deal.id, userId }, data: { payload: stored } });
  revalidatePath(`/app/deals/${deal.id}`);
  return { ok: true, kept: kept.scenario !== null };
}

export async function deleteDeal(id: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in first.");
  await db.deal.deleteMany({ where: { id, userId } });
  revalidatePath("/app/deals");
  redirect("/app/deals");
}
