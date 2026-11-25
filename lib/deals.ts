import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import type { SubjectSources } from "@/lib/listing/subject";

/** Everything needed to re-render a saved deal. Stored as JSON. */
export interface DealPayload {
  report: Report;
  plan?: RenovationPlan;
  assessment?: PhotoAssessment;
  listing?: ListingInfo | null;
  /** Where the market data behind the numbers came from, as the API reported it ("synthetic" = demo). */
  provider?: string;
  /** Where each fact about the house came from: the listing, the caller, or the provider's record. */
  subjectSources?: SubjectSources;
}

/** The most deals one person can keep. A ceiling on the table, far above what a person saves by hand. */
export const MAX_SAVED_DEALS = 500;

export function dealTitle(payload: DealPayload): string {
  const s = payload.report.subject;
  return payload.listing?.address ?? `${s.sqft.toLocaleString()} sqft · ${s.beds} bd / ${s.baths} ba · ${s.submarket}`;
}
