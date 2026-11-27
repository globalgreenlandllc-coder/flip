import { evaluateDeal } from "@/lib/engine/deal";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";
import type { DealResult } from "@/lib/engine/types";

/**
 * The sample deal on the landing page. Only the inputs are hand-picked; every verdict, profit and max offer on the
 * page is produced by the real engine with the default terms, so the marketing never disagrees with the product.
 */
export interface SampleDeal {
  askingPrice: number;
  arv: number;
  rehab: number;
}

export function runSample(s: SampleDeal): DealResult {
  return evaluateDeal(s.arv, { ...DEFAULT_DEAL_TERMS, askingPrice: s.askingPrice, rehab: s.rehab });
}

/** One sample house for the hero card and the explorer alike: 1,840 sqft, comps at $845,000, $58,000 of work. */
export const SAMPLE_DEAL: SampleDeal = { askingPrice: 565_000, arv: 845_000, rehab: 58_000 };

export function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}
