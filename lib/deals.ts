import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import type { SubjectSources } from "@/lib/listing/subject";
import type { DataSource } from "@/lib/data/house-data";
import type { StoredScenario } from "@/lib/api/scenario";

/** Everything needed to re-render a saved deal. Stored as JSON. */
export interface DealPayload {
  report: Report;
  plan?: RenovationPlan;
  assessment?: PhotoAssessment;
  listing?: ListingInfo | null;
  /** Where the market data behind the numbers came from, as the API reported it ("synthetic" = demo, "rentcast" = real sold prices). */
  provider?: string;
  /** For a result built on real records: which record, how many sold homes, how fresh. */
  data?: DataSource;
  /** Where each fact about the house came from: the listing, the caller, or the provider's record. */
  subjectSources?: SubjectSources;
  /**
   * The person's Deal Studio scenario (2026-11-28): their price, timeline, target and assumptions, with the numbers the
   * server worked out from them (lib/api/scenario.ts). Absent: the deal is shown as analysed. The Deal row's columns
   * always hold the analysis' numbers.
   */
  scenario?: StoredScenario;
}

/**
 * The deal's figures as kept in the Deal table's columns. `arv` is the resale the deal was worked out on (after the
 * plan for an analysis, fully renovated for Quick numbers: report.deal.arv), so a card's margin is the result page's
 * margin. Null when the report does not hold a usable deal. Rows saved before 2026-11-28 hold the fully renovated
 * value there, which was then also the value their deal used.
 */
export function dealColumns(report: Report | undefined | null): { askingPrice: number; verdict: string; arv: number; maxOffer: number; profit: number } | null {
  const deal = report?.deal;
  if (!deal) return null;
  const cols = { askingPrice: deal.purchasePrice, verdict: deal.verdict, arv: deal.arv, maxOffer: deal.maxAllowableOffer, profit: deal.profit };
  if (!["GO", "TIGHT", "PASS", "CHECK FIRST"].includes(cols.verdict)) return null;
  if (![cols.askingPrice, cols.arv, cols.maxOffer, cols.profit].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return cols;
}

/** The most deals one person can keep. A ceiling on the table, far above what a person saves by hand. */
export const MAX_SAVED_DEALS = 500;

export function dealTitle(payload: DealPayload): string {
  const s = payload.report.subject;
  return payload.listing?.address ?? payload.data?.record.address ?? [`${s.sqft.toLocaleString()} sqft`, [s.beds === null ? "" : `${s.beds} bd`, s.baths === null ? "" : `${s.baths} ba`].filter(Boolean).join(" / "), s.submarket].filter(Boolean).join(" · ");
}
