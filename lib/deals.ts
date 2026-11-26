import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import type { SubjectSources } from "@/lib/listing/subject";
import type { DataSource } from "@/lib/data/house-data";

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
}

/** The most deals one person can keep. A ceiling on the table, far above what a person saves by hand. */
export const MAX_SAVED_DEALS = 500;

export function dealTitle(payload: DealPayload): string {
  const s = payload.report.subject;
  return payload.listing?.address ?? payload.data?.record.address ?? [`${s.sqft.toLocaleString()} sqft`, [s.beds === null ? "" : `${s.beds} bd`, s.baths === null ? "" : `${s.baths} ba`].filter(Boolean).join(" / "), s.submarket].filter(Boolean).join(" · ");
}
