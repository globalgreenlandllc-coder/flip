import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";

/** Everything needed to re-render a saved deal. Stored as JSON. */
export interface DealPayload {
  report: Report;
  plan?: RenovationPlan;
  assessment?: PhotoAssessment;
  listing?: ListingInfo | null;
}

export function dealTitle(payload: DealPayload): string {
  const s = payload.report.subject;
  return payload.listing?.address ?? `${s.sqft.toLocaleString()} sqft · ${s.beds} bd / ${s.baths} ba · ${s.submarket}`;
}
