import { evaluateDeal } from "@/lib/engine/deal";
import { DEFAULT_DEAL_TERMS } from "@/lib/engine/defaults";
import type { DealResult } from "@/lib/engine/types";

/**
 * Sample deals shown on the landing page. Only the inputs are hand-picked;
 * every verdict, profit and max offer on the page is produced by the real
 * engine with the default terms, so the marketing never disagrees with
 * the product.
 */
export interface SampleDeal {
  askingPrice: number;
  arv: number;
  rehab: number;
}

export function runSample(s: SampleDeal): DealResult {
  return evaluateDeal(s.arv, { ...DEFAULT_DEAL_TERMS, askingPrice: s.askingPrice, rehab: s.rehab });
}

export const HERO_DEAL: SampleDeal = { askingPrice: 699_000, arv: 1_088_000, rehab: 86_300 };

export function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function signedMoney(n: number): string {
  return `${n < 0 ? "−" : "+"}${money(n)}`;
}
